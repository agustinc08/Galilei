'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { ProtectedContent } from '@/components/layout/ProtectedContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { CorpusPdfViewer } from '@/app/(admin)/corpus/[id]/CorpusPdfViewer';
import styles from './ocr-review.module.css';

type QueueItem = {
  documentId: string; title: string; court: string | null; chamber: string | null;
  caseNumber: string | null; fileId: string | null; filename: string | null;
  fileSha256: string | null; pageCount: number; reviewId: string | null;
  status: string; assignedToId: number | null; hasApprovedVersion: boolean;
  approvedPages: number;
};
type QueueResult = {
  page: number; pageSize: number; total: number; pageCount: number;
  counts: { total: number; unreviewed: number; mine: number; ready: number };
  results: QueueItem[];
};
type ReviewPage = {
  id: string; pageNumber: number; version: number; status: string;
  ocrText: string; correctedText: string | null; ocrChecksum: string;
  renderedImageSha256: string | null; confidence: number | null;
  processingError: string | null; approvedById: number | null;
  approvedAt: string | null; approvedChecksum: string | null;
};
type Review = {
  id: string; status: string; version: number; assignedToId: number | null;
  hasApprovedVersion: boolean; currentApprovalId: string | null;
  document: { id: string; title: string; subtitle: string | null; court: string | null;
    chamber: string | null; caseNumber: string | null; status: string };
  file: { id: string; filename: string; mimeType: string; sha256: string;
    sizeBytes: number; pageCount: number; href: string };
  sourcePages: Array<{ pageNumber: number; text: string; textKind: string; processingStatus: string }>;
  activeRun: null | { id: string; runNumber: number; fingerprint: string;
    processorVersion: string; pageCount: number; status: string;
    provenance: Record<string, unknown>; pages: ReviewPage[] };
};
type RuntimeDiagnostics = {
  process: {
    pid: number; nodeVersion: string; executable: string;
    workingDirectory: string; environment: string | null;
  };
  ocr: {
    enabled: boolean; available: boolean; enginePath: string | null;
    engineVersion: string | null; configuredLanguages: string[];
    installedLanguages: string[]; spanishAvailable: boolean;
    tessdataDirectory: string | null; pathContainsEngineDirectory: boolean;
    rendererPath: string | null; rendererVersion: string | null;
    pathContainsRendererDirectory: boolean; temporaryDirectory: string;
    timeoutMs: number; maximumPages: number;
  };
};
type RuntimeCheck = {
  status: string; message: string; errorCode?: string; sha256?: string;
  pageCount?: number; nativeTextCharacters?: number; ocrAttempted?: boolean;
  originalPreserved?: boolean; checkedAt?: string;
  pages?: Array<{ pageNumber: number; characters: number; confidence: number | null; textPreview: string }>;
};

const FILTERS = [
  ['all', 'Todos los pendientes'], ['unassigned', 'Sin asignar'],
  ['mine', 'Asignados a mí'], ['assigned', 'Asignados'], ['ready', 'Listos para aprobar'],
];
const REASONS = [
  ['ILLEGIBLE', 'Ilegible'], ['ROTATED', 'Rotación incorrecta'],
  ['BAD_SCAN', 'Escaneo deficiente'], ['OCR_CORRUPT', 'OCR corrupto'], ['OTHER', 'Otro motivo'],
];

export default function OcrReviewPage() {
  const { user } = useAuth();
  const actorId = user?.id ?? 0;
  const role = user?.rol.nombre ?? '';
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [filter, setFilter] = useState('all');
  const [queuePage, setQueuePage] = useState(1);
  const [review, setReview] = useState<Review | null>(null);
  const [loadedPdf, setLoadedPdf] = useState<{ href: string; url: string; pageCountVerified: boolean } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, { version: number; value: string }>>({});
  const [reason, setReason] = useState('ILLEGIBLE');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [technicalError, setTechnicalError] = useState('');
  const [notice, setNotice] = useState('');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [runtimeDiagnosticsError, setRuntimeDiagnosticsError] = useState('');
  const [runtimeFile, setRuntimeFile] = useState<File | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const loadQueue = useCallback(async (requestedPage = queuePage, requestedFilter = filter) => {
    try {
      const result = await api.get<QueueResult>('/ocr-human-review/queue', {
        query: { filter: requestedFilter, page: requestedPage, pageSize: 25 },
      });
      setQueue(result);
      setError('');
    } catch (cause) {
      setError(messageFor(cause, 'No se pudo cargar la cola OCR.'));
    }
  }, [filter, queuePage]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueue(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  useEffect(() => {
    if (role !== 'ADMIN') return;
    let active = true;
    void api.get<RuntimeDiagnostics>('/ocr-human-review/runtime/diagnostics')
      .then((result) => { if (active) setRuntimeDiagnostics(result); })
      .catch((cause: unknown) => {
        if (active) setRuntimeDiagnosticsError(messageFor(cause, 'No se pudo leer el estado del proceso OCR.'));
      });
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setGuideOpen(!media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const page = useMemo(
    () => review?.activeRun?.pages.find((item) => item.pageNumber === pageNumber) ?? null,
    [pageNumber, review],
  );
  const sourcePage = review?.sourcePages.find((item) => item.pageNumber === pageNumber) ?? null;
  const baseline = page ? (page.correctedText ?? page.ocrText) : '';
  const savedDraft = page ? drafts[page.id] : undefined;
  const draft = page && savedDraft?.version === page.version ? savedDraft.value : baseline;
  const unsaved = Boolean(page && draft !== baseline);
  const pdfUrl = review && loadedPdf?.href === review.file.href ? loadedPdf.url : null;
  const pdfPageCountVerified = Boolean(review && loadedPdf?.href === review.file.href && loadedPdf.pageCountVerified);
  const terminalCount = review?.activeRun?.pages.filter((item) => ['APPROVED', 'NO_TEXT'].includes(item.status)).length ?? 0;
  const lockedForOther = Boolean(review?.assignedToId && review.assignedToId !== actorId && !['ADMIN', 'OPERADOR'].includes(role));
  const canApproveDocument = Boolean(
    review?.activeRun?.status === 'COMPLETE' &&
    review.activeRun.pages.length === review.file.pageCount &&
    terminalCount === review.file.pageCount && !unsaved &&
    (review.document.status === 'OCR_REQUIRED' || (review.hasApprovedVersion && review.document.status === 'INDEXED')) && pdfPageCountVerified,
  );

  useEffect(() => {
    const href = review?.file.href;
    if (!href) return;
    let active = true;
    let objectUrl: string | null = null;
    void api.download(href).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setLoadedPdf({ href, url: objectUrl, pageCountVerified: false });
      setError('');
    }).catch((cause: unknown) => {
      if (active) setError(messageFor(cause, 'No se pudo abrir el PDF original.'));
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [review?.file.href]);

  useEffect(() => {
    if (busy !== 'ocr' || !review?.id) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api.get<Review>('/ocr-human-review/' + review.id)
        .then((updated) => { if (active) setReview(updated); })
        .catch(() => { /* The generating request reports its authoritative error. */ });
    }, 1200);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, review?.id]);

  const openDocument = async (item: QueueItem) => {
    setBusy('open'); setError(''); setNotice(''); setReview(null); setLoadedPdf(null); setDrafts({});
    try {
      let opened = await api.post<Review>('/ocr-human-review/documents/' + item.documentId + '/open');
      if (!opened.assignedToId || opened.assignedToId === actorId)
        opened = await api.post<Review>('/ocr-human-review/' + opened.id + '/assign');
      setReview(opened); setPageNumber(1);
      setNotice('Revisión abierta. El PDF original permanece sin cambios.');
    } catch (cause) {
      setError(messageFor(cause, 'No se pudo abrir la revisión.'));
    } finally { setBusy(''); }
  };

  const refreshReview = async (id = review?.id) => {
    if (!id) return;
    const current = await api.get<Review>('/ocr-human-review/' + id);
    setReview(current);
    return current;
  };
  const runAction = async (name: string, action: () => Promise<Review | void>) => {
    setBusy(name); setError(''); setTechnicalError(''); setNotice('');
    try {
      const updated = await action();
      if (updated) setReview(updated);
      else await refreshReview();
      await loadQueue(queuePage, filter);
    } catch (cause) {
      setError(messageFor(cause, 'No se pudo completar la acción.'));
      setTechnicalError(technicalMessageFor(cause));
    } finally { setBusy(''); }
  };
  const generateOcr = async (force = false) => {
    if (!review) return;
    if (force && !window.confirm('¿Generar otra ejecución OCR local? La anterior y sus correcciones quedarán preservadas.')) return;
    await runAction('ocr', async () => {
      const result = await api.post<Review>('/ocr-human-review/' + review.id + '/ocr', { force });
      setPageNumber(1);
      setNotice(force ? 'Nueva ejecución OCR lista; la anterior se conserva en el historial.' : 'OCR local listo para revisión humana.');
      return result;
    });
  };
  const verifyRuntime = async () => {
    if (!runtimeFile) return;
    if (runtimeFile.size > 20 * 1024 * 1024) {
      setRuntimeDiagnosticsError('El PDF supera el límite de 20 MiB.');
      return;
    }
    const form = new FormData();
    form.append('file', runtimeFile);
    setRuntimeBusy(true);
    setRuntimeCheck(null);
    setRuntimeDiagnosticsError('');
    try {
      const result = await api.post<RuntimeCheck>('/ocr-human-review/runtime/verify', form);
      setRuntimeCheck(result);
      setRuntimeFile(null);
      const input = document.getElementById('ocr-runtime-file');
      if (input instanceof HTMLInputElement) input.value = '';
    } catch (cause) {
      setRuntimeDiagnosticsError(messageFor(cause, 'No se pudo verificar el motor OCR en este proceso.'));
    } finally {
      setRuntimeBusy(false);
    }
  };
  const saveCorrection = async () => {
    if (!review || !page) return;
    await runAction('save', async () => {
      const updated = await api.post<Review>(
        '/ocr-human-review/' + review.id + '/pages/' + page.pageNumber + '/save',
        { expectedVersion: page.version, correctedText: draft },
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[page.id];
        return next;
      });
      setNotice('Corrección guardada con historial y checksum.');
      return updated;
    });
  };
  const transition = async (action: 'approve' | 'no-text' | 'reject' | 'reopen') => {
    if (!review || !page) return;
    if (unsaved) { setError('Guardá la corrección antes de cambiar el estado de la página.'); return; }
    if (action === 'no-text' && !window.confirm('Confirmá que esta página física no contiene texto que deba incorporarse a Search.')) return;
    if (action === 'approve' && !window.confirm('¿Aprobar el texto de la página ' + page.pageNumber + '?')) return;
    if (action === 'reopen' && !window.confirm('¿Reabrir la página? La versión Search aprobada seguirá activa hasta una nueva aprobación completa.')) return;
    const endpoint = action === 'no-text' ? 'no-text' : action;
    await runAction(action, () => api.post<Review>(
      '/ocr-human-review/' + review.id + '/pages/' + page.pageNumber + '/' + endpoint,
      { expectedVersion: page.version, ...(action === 'reject' ? { reason } : {}) },
    ));
  };
  const approveDocument = async () => {
    if (!review || !canApproveDocument) return;
    if (!window.confirm('¿Aprobar el documento y enviar el texto revisado a Search interno? El PDF y la publicación judicial no cambian.')) return;
    await runAction('final-approve', async () => {
      const result = await api.post<{ searchOutbox: string }>(
        '/ocr-human-review/' + review.id + '/approve',
      );
      await refreshReview();
      setNotice('Documento aprobado. Search ' + result.searchOutbox + '; el fallo sigue sin publicarse.');
    });
  };
  const navigatePage = (target: number) => {
    const max = review?.file.pageCount ?? 1;
    setPageNumber(Math.min(max, Math.max(1, target)));
  };
  const nextPending = (direction: 1 | -1) => {
    if (!review?.activeRun) return;
    const pending = review.activeRun.pages
      .filter((item) => !['APPROVED', 'NO_TEXT'].includes(item.status))
      .map((item) => item.pageNumber).sort((left, right) => left - right);
    if (!pending.length) return;
    const next = direction > 0
      ? pending.find((value) => value > pageNumber) ?? pending[0]
      : [...pending].reverse().find((value) => value < pageNumber) ?? pending[pending.length - 1];
    navigatePage(next);
  };

  return (
    <ProtectedContent allowedRoles={['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA']} redirectTo="/dashboard">
      <main className={styles.page}>
        <PageHeader title="Revisión humana de OCR" description="Compará cada página con su PDF, corregí el texto y aprobá cada decisión antes de incorporarla a Search interno." />
        <details className={styles.ocrGuide} open={guideOpen}>
          <summary onClick={(event) => { event.preventDefault(); setGuideOpen((open) => !open); }}>
            <strong>¿Cuándo usar OCR?</strong><span>Guía del proceso · el PDF original se conserva</span>
          </summary>
          <div className={styles.ocrGuideCopy}>
            <p>OCR convierte en texto buscable las páginas escaneadas de un PDF. Usalo cuando no puedas seleccionar o buscar texto dentro del documento.</p>
            <p><strong>El archivo original no se reemplaza.</strong> El texto reconocido queda pendiente de revisión humana antes de incorporarse a Search.</p>
          </div>
          <ol aria-label="Pasos del proceso OCR">
            <li>Detectar</li><li>Procesar</li><li>Revisar</li><li>Aprobar</li><li>Indexar</li>
          </ol>
        </details>
        <section className={styles.notice}>
          <strong>Original preservado.</strong> El OCR y las correcciones quedan pendientes hasta la aprobación explícita de todas las páginas. Este flujo no publica fallos ni modifica metadatos legales.
        </section>
        {role === 'ADMIN' && <details className={styles.runtimeDiagnostic}>
          <summary>Diagnóstico del runtime OCR (solo Administración)</summary>
          <p>Comprueba el proceso que está ejecutando Office. El archivo se procesa en memoria, no se guarda ni crea un documento. Usá un PDF técnico de hasta 3 páginas y 20 MiB.</p>
          {runtimeDiagnostics ? <>
            <p className={runtimeDiagnostics.ocr.available && runtimeDiagnostics.ocr.enabled ? styles.runtimeReady : styles.warning} role="status">
              {runtimeDiagnostics.ocr.available && runtimeDiagnostics.ocr.enabled
                ? `Motor disponible · ${runtimeDiagnostics.ocr.engineVersion} · español ${runtimeDiagnostics.ocr.spanishAvailable ? 'disponible' : 'no disponible'}`
                : 'El motor OCR no está listo en el proceso actual.'}
            </p>
            <details className={styles.provenance}><summary>Proceso, rutas y entorno heredado</summary><dl>
              <dt>Proceso</dt><dd>PID {runtimeDiagnostics.process.pid} · Node {runtimeDiagnostics.process.nodeVersion}</dd>
              <dt>Ejecutable</dt><dd>{runtimeDiagnostics.process.executable}</dd>
              <dt>Directorio de trabajo</dt><dd>{runtimeDiagnostics.process.workingDirectory}</dd>
              <dt>Entorno</dt><dd>{runtimeDiagnostics.process.environment ?? 'No informado'}</dd>
              <dt>Tesseract</dt><dd>{runtimeDiagnostics.ocr.enginePath ?? 'No encontrado'} · PATH contiene carpeta: {runtimeDiagnostics.ocr.pathContainsEngineDirectory ? 'sí' : 'no'}</dd>
              <dt>tessdata</dt><dd>{runtimeDiagnostics.ocr.tessdataDirectory ?? 'No encontrado'} · idiomas: {runtimeDiagnostics.ocr.installedLanguages.join(', ') || 'ninguno'}</dd>
              <dt>Renderizador</dt><dd>{runtimeDiagnostics.ocr.rendererPath ?? 'No encontrado'} · PATH contiene carpeta: {runtimeDiagnostics.ocr.pathContainsRendererDirectory ? 'sí' : 'no'}</dd>
              <dt>Temporales y límites</dt><dd>{runtimeDiagnostics.ocr.temporaryDirectory} · {runtimeDiagnostics.ocr.timeoutMs} ms · máximo configurado {runtimeDiagnostics.ocr.maximumPages} páginas</dd>
            </dl></details>
          </> : <p className={styles.muted}>{runtimeDiagnosticsError || 'Consultando el proceso…'}</p>}
          <div className={styles.runtimeCheckRow}>
            <label htmlFor="ocr-runtime-file">PDF técnico temporal</label>
            <input id="ocr-runtime-file" type="file" accept="application/pdf,.pdf" onChange={(event) => { setRuntimeFile(event.target.files?.[0] ?? null); setRuntimeCheck(null); setRuntimeDiagnosticsError(''); }} />
            <button type="button" className={styles.secondaryButton} disabled={!runtimeFile || runtimeBusy} onClick={() => void verifyRuntime()}>
              {runtimeBusy ? 'Verificando…' : 'Comprobar en este proceso'}
            </button>
          </div>
          {runtimeDiagnosticsError && <p className={styles.error} role="alert">{runtimeDiagnosticsError}</p>}
          {runtimeCheck && <div className={styles.runtimeResult} role="status" aria-live="polite">
            <strong>{runtimeCheck.message}</strong>
            <span>Resultado: {runtimeStatusLabel(runtimeCheck.status)} · OCR ejecutado: {runtimeCheck.ocrAttempted ? 'sí' : 'no'} · original preservado: {runtimeCheck.originalPreserved ? 'sí' : 'no'}</span>
            {runtimeCheck.pages?.map((item) => <p key={item.pageNumber}>Página {item.pageNumber} · {item.characters} caracteres · confianza {item.confidence === null ? 'no informada' : `${item.confidence.toFixed(1)} %`}</p>)}
            {runtimeCheck.pages?.some((item) => item.textPreview) && <details><summary>Texto reconocido del PDF de prueba</summary><pre>{runtimeCheck.pages.map((item) => item.textPreview).join('\n')}</pre></details>}
            {runtimeCheck.errorCode && <details><summary>Detalle técnico</summary><code>{runtimeCheck.errorCode}</code></details>}
          </div>}
        </details>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {technicalError && role === 'ADMIN' && <details className={styles.technicalError}><summary>Detalle técnico</summary><pre>{technicalError}</pre></details>}
        {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}

        <div className={styles.workspace}>
          <aside className={styles.queueColumn} aria-label="Cola de revisión OCR">
            <Card>
              <div className={styles.queueHeader}>
                <div><h2>Cola institucional</h2><p>{queue?.counts.total ?? 0} pendientes · {queue?.counts.unreviewed ?? 0} sin revisar · {queue?.counts.ready ?? 0} listos para aprobar</p></div>
                <button type="button" className={styles.secondaryButton} onClick={() => void loadQueue()} disabled={busy !== ''}>Actualizar</button>
              </div>
              <label className={styles.filterLabel} htmlFor="ocr-queue-filter">Filtrar cola</label>
              <select id="ocr-queue-filter" value={filter} onChange={(event) => {
                setFilter(event.target.value); setQueuePage(1); void loadQueue(1, event.target.value);
              }}>
                {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className={styles.queueList} aria-live="polite">
                {queue?.results.length ? queue.results.map((item) => (
                  <button type="button" key={item.documentId}
                    className={styles.queueItem + ' ' + (review?.document.id === item.documentId ? styles.queueItemActive : '')}
                    onClick={() => void openDocument(item)} disabled={busy !== ''}>
                    <strong>{queueDocumentTitle(item.title)}</strong>
                    <span>{[item.court, item.chamber, item.caseNumber].filter(Boolean).join(' · ') || 'Metadatos de carátula incompletos'}</span>
                    <span>{item.pageCount} páginas · {item.approvedPages}/{item.pageCount} resueltas</span>
                    <span>{queueStatus(item.status)}{item.assignedToId ? (item.assignedToId === actorId ? ' · tomado por vos' : ' · tomado por otro revisor') : ''}</span>
                  </button>
                )) : <p className={styles.muted}>No hay documentos con esos filtros.</p>}
              </div>
              <div className={styles.pagination}>
                <button type="button" className={styles.secondaryButton} disabled={!queue || queue.page <= 1 || busy !== ''} onClick={() => { const next = Math.max(1, queuePage - 1); setQueuePage(next); void loadQueue(next); }}>Anterior</button>
                <span>Página {queue?.page ?? 1} de {Math.max(1, queue?.pageCount ?? 1)}</span>
                <button type="button" className={styles.secondaryButton} disabled={!queue || queue.page >= queue.pageCount || busy !== ''} onClick={() => { const next = queuePage + 1; setQueuePage(next); void loadQueue(next); }}>Siguiente</button>
              </div>
            </Card>
          </aside>

          <section className={styles.reviewColumn} aria-label="Espacio de revisión">
            {!review ? <Card><div className={styles.emptyState}><h2>Elegí un documento</h2><p>La cola solo muestra material institucional interno que requiere OCR.</p></div></Card> : <>
              <Card>
                <div className={styles.documentHeading}>
                  <div><p className={styles.eyebrow}>REVISIÓN {review.id.slice(0, 10)}</p><h2>{review.document.title}</h2><p>{[review.document.court, review.document.chamber, review.document.caseNumber].filter(Boolean).join(' · ')}</p></div>
                  <span className={styles.statusBadge}>{queueStatus(review.status)}</span>
                </div>
                <div className={styles.fileFacts}>
                  <span>{review.file.filename}</span><span>{review.file.pageCount} páginas</span>
                  <span>PDF SHA-256 {review.file.sha256.slice(0, 16)}…</span>
                  {review.hasApprovedVersion && <strong>Versión aprobada previa activa</strong>}
                </div>
                {review.assignedToId === actorId ? <p className={styles.muted}>Tomado por vos · sin cambios de metadata o publicación.</p>
                  : review.assignedToId && lockedForOther ? <p className={styles.warning}>Asignado a otro revisor. Esta cuenta no puede modificar el trabajo.</p>
                  : review.assignedToId ? <p className={styles.muted}>Asignado a otro revisor. Administración puede intervenir.</p>
                  : <button type="button" className={styles.secondaryButton} disabled={busy !== ''} onClick={() => void runAction('assign', () => api.post<Review>('/ocr-human-review/' + review.id + '/assign'))}>Tomar documento</button>}
                {!review.activeRun && <button type="button" className={styles.primaryButton} disabled={busy !== '' || lockedForOther} onClick={() => void generateOcr()}>{busy === 'ocr' ? 'Procesando OCR local…' : 'Generar OCR local'}</button>}
                {busy === 'ocr' && <div className={styles.ocrProgress} role="status" aria-live="polite">
                  <strong>{review.activeRun?.status === 'RUNNING'
                    ? `Procesando página ${Math.min(review.activeRun.pages.length + 1, review.file.pageCount)} de ${review.file.pageCount}`
                    : 'Preparando la ejecución OCR local…'}</strong>
                  {review.activeRun?.status === 'RUNNING' && <>
                    <progress max={review.file.pageCount} value={review.activeRun.pages.length} aria-label="Progreso de páginas OCR" />
                    <span>{review.activeRun.pages.length} de {review.file.pageCount} páginas terminadas</span>
                  </>}
                </div>}
                {review.activeRun && <div className={styles.runSummary}>
                  <span>OCR local #{review.activeRun.runNumber} · {review.activeRun.processorVersion}</span>
                  <span>{terminalCount}/{review.file.pageCount} páginas resueltas</span>
                  <button type="button" className={styles.secondaryButton} disabled={busy !== '' || lockedForOther} onClick={() => void generateOcr(true)}>Nueva ejecución OCR</button>
                </div>}
                {review.activeRun?.status === 'FAILED' ? <div className={styles.warning} role="alert">
                  <strong>No se pudieron preparar las páginas para revisión.</strong>
                  <p>{ocrRunRecoveryMessage(review.activeRun.provenance)}</p>
                  <p>El PDF original permanece sin cambios. Cuando Administración confirme que el motor está disponible, podés iniciar una nueva ejecución OCR.</p>
                  {role === 'ADMIN' && ocrRunFailureCode(review.activeRun.provenance) ? <details><summary>Detalle técnico</summary><code>{ocrRunFailureCode(review.activeRun.provenance)}</code></details> : null}
                </div> : null}
              </Card>

              {review.activeRun && <div className={styles.reviewGrid}>
                <Card className={styles.pdfCard}>
                  <div className={styles.panelHeading}><h3>PDF original</h3><span>Página {pageNumber} de {review.file.pageCount}</span></div>
                  <div className={styles.pageControls}>
                    <button type="button" className={styles.secondaryButton} disabled={pageNumber <= 1} onClick={() => navigatePage(pageNumber - 1)}>Anterior</button>
                    <label htmlFor="ocr-page-number">Ir a página</label>
                    <input id="ocr-page-number" type="number" min={1} max={review.file.pageCount} value={pageNumber} onChange={(event) => navigatePage(Number(event.target.value) || 1)} />
                    <button type="button" className={styles.secondaryButton} disabled={pageNumber >= review.file.pageCount} onClick={() => navigatePage(pageNumber + 1)}>Siguiente</button>
                    <button type="button" className={styles.secondaryButton} onClick={() => nextPending(-1)}>Pendiente anterior</button>
                    <button type="button" className={styles.secondaryButton} onClick={() => nextPending(1)}>Pendiente siguiente</button>
                  </div>
                  <div className={styles.pdfPane}>
                    {pdfUrl ? <Suspense fallback={<p role="status" aria-live="polite">Cargando visor PDF…</p>}>
                      <CorpusPdfViewer file={pdfUrl} page={pageNumber} sourceText={sourcePage?.text ?? null} matches={[]} activeMatch={0}
                        onLoadSuccess={(count) => {
                          const matches = count === review.file.pageCount;
                          setLoadedPdf((current) => current?.href === review.file.href
                            ? { ...current, pageCountVerified: matches }
                            : current);
                          if (!matches) setError('El PDF informa otra cantidad de páginas; no se permite finalizar hasta corregir la discrepancia.');
                        }}
                        onGoToPage={navigatePage} />
                    </Suspense> : <p role="status">Cargando PDF original…</p>}
                  </div>
                </Card>

                <Card className={styles.textCard}>
                  {page ? <>
                    <div className={styles.panelHeading}>
                      <div><h3>Página {pageNumber}</h3><p>{pageStatusLabel(page.status)}</p></div>
                      <span>{terminalCount}/{review.file.pageCount} resueltas</span>
                    </div>
                    {page.processingError && <p className={styles.warning}>El OCR no obtuvo texto confiable. Revisá el original o confirmá “Sin texto” si corresponde.</p>}
                    <section className={styles.textSource} aria-labelledby="ocr-source-heading">
                      <h4 id="ocr-source-heading">Texto OCR sin modificar</h4>
                      <pre>{page.ocrText || 'El motor local no detectó texto utilizable en esta página.'}</pre>
                    </section>
                    <label className={styles.editorLabel} htmlFor="ocr-corrected-text">Texto corregido</label>
                    <textarea id="ocr-corrected-text" value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [page.id]: { version: page.version, value: event.target.value } }))}
                      maxLength={120000} spellCheck disabled={lockedForOther || ['APPROVED', 'NO_TEXT'].includes(page.status) || busy !== ''}
                      aria-describedby="ocr-correction-help" />
                    <p id="ocr-correction-help" className={styles.muted}>Guardado explícito · hasta 120.000 caracteres por página · historial con actor, fecha y checksum.</p>
                    {unsaved && <p className={styles.unsaved} role="status">Hay cambios sin guardar.</p>}
                    <div className={styles.actionRow}>
                      <button type="button" className={styles.primaryButton} disabled={!unsaved || lockedForOther || busy !== ''} onClick={() => void saveCorrection()}>{busy === 'save' ? 'Guardando…' : 'Guardar cambios'}</button>
                      {!['APPROVED', 'NO_TEXT'].includes(page.status) ? <>
                        <button type="button" className={styles.primaryButton} disabled={unsaved || lockedForOther || busy !== ''} onClick={() => void transition('approve')}>Aprobar página</button>
                        <button type="button" className={styles.secondaryButton} disabled={unsaved || lockedForOther || busy !== ''} onClick={() => void transition('no-text')}>Página sin texto</button>
                        <label className={styles.reasonLabel} htmlFor="ocr-reject-reason">Motivo</label>
                        <select id="ocr-reject-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy !== ''}>
                          {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button type="button" className={styles.secondaryButton} disabled={unsaved || lockedForOther || busy !== ''} onClick={() => void transition('reject')}>Requiere nueva revisión</button>
                      </> : <button type="button" className={styles.secondaryButton} disabled={lockedForOther || busy !== ''} onClick={() => void transition('reopen')}>Reabrir página</button>}
                    </div>
                    <details className={styles.provenance}><summary>Procedencia y controles</summary><dl>
                      <dt>Checksum OCR</dt><dd>{page.ocrChecksum}</dd>
                      <dt>Imagen de página</dt><dd>{page.renderedImageSha256 ?? 'No disponible para esta ejecución'}</dd>
                      <dt>Confianza</dt><dd>{page.confidence === null ? 'No informada' : page.confidence.toFixed(1) + ' %'}</dd>
                      <dt>Aprobada por</dt><dd>{page.approvedById ? 'Usuario #' + page.approvedById : 'Pendiente'}</dd>
                      <dt>Aprobada el</dt><dd>{page.approvedAt ? new Date(page.approvedAt).toLocaleString() : 'Pendiente'}</dd>
                      <dt>Versión del motor</dt><dd>{review.activeRun.processorVersion}</dd>
                    </dl></details>
                  </> : <p role="status">La ejecución no contiene la página solicitada.</p>}
                </Card>
              </div>}

              {review.activeRun && <Card><div className={styles.finalApproval}>
                <div><h3>Aprobación del documento</h3>
                  <p>Requiere todas las páginas aprobadas o confirmadas sin texto. Solo el texto aprobado entra a Search interno.</p>
                  {review.hasApprovedVersion && <p className={styles.muted}>La extracción aprobada sigue activa mientras revisás la siguiente versión.</p>}
                </div>
                <button type="button" className={styles.primaryButton} disabled={!canApproveDocument || busy !== '' || lockedForOther} onClick={() => void approveDocument()}>
                  {busy === 'final-approve' ? 'Aprobando…' : 'Aprobar documento completo'}
                </button>
              </div></Card>}
            </>}
          </section>
        </div>
      </main>
    </ProtectedContent>
  );
}

function queueStatus(status: string) {
  return ({ PENDING: 'Pendiente', IN_REVIEW: 'En revisión', READY_FOR_APPROVAL: 'Listo para aprobación', APPROVED: 'Aprobado', FAILED: 'Falló' } as Record<string, string>)[status] ?? status;
}
function queueDocumentTitle(title: string) {
  return /^\d+$/u.test(title.trim()) ? `Documento sin carátula · referencia #${title}` : title;
}
function runtimeStatusLabel(status: string) {
  return ({ NATIVE_TEXT_FOUND: 'texto nativo detectado', OCR_READY_FOR_HUMAN_REVIEW: 'listo para revisión humana', OCR_REVIEW_REQUIRED: 'requiere revisión humana', OCR_NO_TEXT: 'sin texto utilizable', CONTROLLED_ERROR: 'error controlado' } as Record<string, string>)[status] ?? status;
}
function pageStatusLabel(status: string) {
  return ({ NEEDS_REVIEW: 'Pendiente de revisión', REOPENED: 'Reabierta', REJECTED: 'Requiere nueva revisión', APPROVED: 'Aprobada', NO_TEXT: 'Sin texto confirmado' } as Record<string, string>)[status] ?? status;
}
function ocrRunFailureCode(provenance: Record<string, unknown>) {
  const code = provenance.failureCode;
  return typeof code === 'string' && /^[A-Z0-9_]{3,80}$/u.test(code) ? code : null;
}
function ocrRunRecoveryMessage(provenance: Record<string, unknown>) {
  const code = ocrRunFailureCode(provenance);
  if (code === 'OCR_ENGINE_UNAVAILABLE') return 'El motor OCR local no está disponible en Office. Pedí a Administración que revise el proceso y sus herramientas de reconocimiento.';
  if (code === 'OCR_LANGUAGE_UNAVAILABLE') return 'Falta el idioma español en el motor OCR local. Administración debe revisar su instalación antes de volver a procesar.';
  if (code === 'OCR_DISABLED') return 'El OCR está desactivado para el proceso actual de Office. Administración debe revisar la configuración del servicio.';
  if (code === 'OCR_RENDER_FAILED') return 'Office no pudo convertir el PDF en páginas de revisión. Administración debe revisar el renderizador PDF.';
  if (code === 'OCR_TIMEOUT') return 'El procesamiento excedió el tiempo permitido. Revisá que el PDF se pueda abrir y pedí a Administración que compruebe los límites del servicio.';
  return 'La ejecución terminó sin páginas revisables. Administración debe revisar el estado del motor OCR antes de iniciar otro intento.';
}
function messageFor(cause: unknown, fallback: string) {
  const detail = technicalMessageFor(cause);
  if (/OCR_ENGINE_UNAVAILABLE|OCR_LANGUAGE_UNAVAILABLE/u.test(detail))
    return 'El motor OCR local no está disponible en este equipo. El PDF original se conserva; podés volver a intentar cuando el servicio esté operativo.';
  if (/OCR_DISABLED/u.test(detail))
    return 'El OCR local está desactivado en este equipo. El PDF original se conserva.';
  if (/OCR_RENDER_FAILED|PDF_INFO_UNAVAILABLE/u.test(detail))
    return 'No se pudo preparar una página del PDF para el OCR. El archivo original se conserva; revisá que el PDF se pueda abrir e intentá nuevamente.';
  if (/OCR_LOW_QUALITY/u.test(detail))
    return 'El texto reconocido no alcanzó una calidad suficiente. El PDF original se conserva para revisión manual.';
  if (cause instanceof ApiError && cause.status === 409)
    return cause.message || 'La revisión cambió en otra sesión. Recargá para continuar.';
  if (cause instanceof ApiError && cause.message)
    return cause.message.replace(/\s*\([^)]*(?:OCR|PDF)_[A-Z_]+[^)]*\)\.?\s*/gu, '');
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
function technicalMessageFor(cause: unknown) {
  return cause instanceof Error ? cause.message : '';
}
