'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useRouter, useSearchParams } from '@/lib/router-compat';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { copyToClipboard, formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useEvolutionSelection } from './EvolutionSelection';
import { evolutionYear, parseEvolutionSlugs, publicEvolutionHref, sortEvolutionEvents } from '@/lib/evolution-utils';
import styles from './evolution-workspace.module.css';

type EvolutionJudgment = {
  slug: string;
  caratula: string | null;
  cita: string;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  decisionDate: string | null;
  dateStatus: 'AVAILABLE' | 'UNAVAILABLE';
  year: number | null;
  expediente: string | null;
  hasPdf: boolean;
  sumarioCount: number;
  verifiedCitesCount: number;
  verifiedCitedByCount: number;
};
type EvolutionPayload = {
  judgments: EvolutionJudgment[];
  verifiedCitationEdges: Array<{
    type: 'VERIFIED_CITATION';
    sourceSlug: string;
    targetSlug: string;
    evidence: string;
    page: number | null;
  }>;
  sameExpedienteGroups: Array<{
    type: 'SAME_EXPEDIENTE';
    expediente: string;
    slugs: string[];
  }>;
  omittedCount: number;
  truncatedCitationEvidence: boolean;
};
type SavedTimeline = {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  slugs: string[];
  omittedCount: number;
  itemCount?: number;
};
type ResolutionState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'success'; data: EvolutionPayload }
  | { key: string; status: 'error' };
type SavedTimelineState =
  | { id: string; status: 'ready'; data: SavedTimeline }
  | { id: string; status: 'error' };
type SavedTimelineListState = { ownerId: number; data: SavedTimeline[] };
const EMPTY_JUDGMENTS: EvolutionJudgment[] = [];

function titleFor(judgment: EvolutionJudgment) {
  return judgment.caratula || judgment.numeroSentencia || judgment.expediente || `Fallo ${judgment.slug}`;
}

function yearGroups(judgments: EvolutionJudgment[]) {
  const groups = new Map<number, EvolutionJudgment[]>();
  const undated: EvolutionJudgment[] = [];
  for (const judgment of sortEvolutionEvents(judgments)) {
    const year = evolutionYear(judgment.decisionDate);
    if (year === null) undated.push(judgment);
    else groups.set(year, [...(groups.get(year) ?? []), judgment]);
  }
  const result: Array<{ year: number | null; events: EvolutionJudgment[] }> =
    [...groups.entries()].map(([year, events]) => ({ year, events }));
  if (undated.length) result.push({ year: null, events: undated });
  return result;
}

export function EvolutionWorkspacePage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const savedId = routeId ?? null;
  const query = useSearchParams();
  const router = useRouter();
  const selection = useEvolutionSelection();
  const replaceSelection = selection.replace;
  const { user, isLoading: authLoading } = useAuth();
  const requestedFromUrl = query.get('ids');
  const parsedUrlSlugs = useMemo(() => parseEvolutionSlugs(requestedFromUrl), [requestedFromUrl]);
  const [savedTimelineState, setSavedTimelineState] = useState<SavedTimelineState | null>(null);
  const [savedTimelineListState, setSavedTimelineListState] = useState<SavedTimelineListState | null>(null);
  const [resolutionState, setResolutionState] = useState<ResolutionState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSala, setSelectedSala] = useState('ALL');
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const selectionSlugs = useMemo(() => selection.items.map((item) => item.slug), [selection.items]);
  const requestedSlugs = !savedId && requestedFromUrl !== null
    ? (parsedUrlSlugs ?? [])
    : selectionSlugs;
  const requestedKey = requestedSlugs.join(',');
  const savedTimeline = savedTimelineState?.id === savedId && savedTimelineState.status === 'ready'
    ? savedTimelineState.data
    : null;
  const invalidSavedId = Boolean(savedId && !/^\d{1,10}$/u.test(savedId));
  const savedTimelineLoading = Boolean(savedId && user && !authLoading && /^\d{1,10}$/u.test(savedId) && savedTimelineState?.id !== savedId);
  const savedTimelineError = Boolean(invalidSavedId || (savedId && savedTimelineState?.id === savedId && savedTimelineState.status === 'error'));
  const savedTimelines = user && savedTimelineListState?.ownerId === user.id && !savedId
    ? savedTimelineListState.data
    : [];
  const savedListLoading = Boolean(user && !authLoading && !savedId && savedTimelineListState?.ownerId !== user.id);
  const resolution = resolutionState?.key === requestedKey ? resolutionState : null;
  const payload = resolution?.status === 'success' ? resolution.data : null;
  const resolving = Boolean(requestedSlugs.length >= 2 && (!resolution || resolution.status === 'loading'));
  const resolutionError = resolution?.status === 'error';
  const invalidUrl = !savedId && requestedFromUrl !== null && parsedUrlSlugs === null;
  const publicJudgments = payload?.judgments ?? EMPTY_JUDGMENTS;
  const titleBySlug = useMemo(() => new Map(publicJudgments.map((judgment) => [judgment.slug, titleFor(judgment)])), [publicJudgments]);
  const visibleJudgments = useMemo(
    () => selectedSala === 'ALL' ? publicJudgments : publicJudgments.filter((item) => item.sala === selectedSala),
    [publicJudgments, selectedSala],
  );
  const groups = useMemo(() => yearGroups(visibleJudgments), [visibleJudgments]);
  const salas = useMemo(() => [...new Set(publicJudgments.flatMap((item) => item.sala ? [item.sala] : []))].sort((a, b) => a.localeCompare(b, 'es')),
    [publicJudgments]);
  useEffect(() => {
    if (!savedId || authLoading || !user || !/^\d{1,10}$/u.test(savedId)) return;
    let active = true;
    void api.get<ApiResponse<SavedTimeline>>(`/research/timelines/${savedId}`)
      .then((response) => {
        if (!active) return;
        setSavedTimelineState({ id: savedId, status: 'ready', data: response.data });
        replaceSelection(response.data.slugs.map((slug) => ({ slug, title: `Fallo ${slug}` })));
        setName(response.data.name);
        setDescription(response.data.description ?? '');
      })
      .catch(() => {
        if (active) {
          setSavedTimelineState({ id: savedId, status: 'error' });
        }
      })
      ;
    return () => { active = false; };
  }, [authLoading, savedId, replaceSelection, user]);

  useEffect(() => {
    if (savedId || authLoading || !user) return;
    let active = true;
    void api.get<ApiResponse<SavedTimeline[]>>('/research/timelines')
      .then((response) => { if (active) setSavedTimelineListState({ ownerId: user.id, data: response.data }); })
      .catch(() => { if (active) setSavedTimelineListState({ ownerId: user.id, data: [] }); });
    return () => { active = false; };
  }, [authLoading, savedId, user]);

  useEffect(() => {
    if (invalidUrl || requestedSlugs.length < 2) return;
    if (savedId && (savedTimelineLoading || !savedTimeline || !user)) return;
    let active = true;
    const key = requestedKey;
    void Promise.resolve().then(() => {
      setResolutionState({ key, status: 'loading' });
      return api.post<ApiResponse<EvolutionPayload>>('/research/evolution/resolve', { slugs: key.split(',') }, { skipAuth: true });
    })
      .then((response) => {
        if (!active) return;
        setResolutionState({ key, status: 'success', data: response.data });
        const resolved = response.data.judgments.map((judgment) => ({ slug: judgment.slug, title: titleFor(judgment) }));
        replaceSelection(resolved);
        setCompareSlugs((current) => current.filter((slug) => resolved.some((item) => item.slug === slug)));
      })
      .catch(() => {
        if (active) {
          setResolutionState({ key, status: 'error' });
        }
      })
      ;
    return () => { active = false; };
  }, [invalidUrl, requestedKey, requestedSlugs.length, retryCount, savedId, savedTimeline, savedTimelineLoading, replaceSelection, user]);

  const loadSaved = useCallback(async () => {
    if (!user) return;
    try {
      const response = await api.get<ApiResponse<SavedTimeline[]>>('/research/timelines');
      setSavedTimelineListState({ ownerId: user.id, data: response.data });
    } catch {
      setSavedTimelineListState({ ownerId: user.id, data: [] });
    }
  }, [user]);

  const saveNew = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || publicJudgments.length < 2) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<ApiResponse<SavedTimeline>>('/research/timelines', {
        name: name.trim(),
        description: description.trim() || null,
        slugs: publicJudgments.map((item) => item.slug),
      });
      setNotice('Espacio de evolución guardado en tu cuenta.');
      await loadSaved();
      router.push(`/evolucion/guardada/${response.data.id}`);
    } catch {
      setError('No se pudo guardar el espacio. Verificá el nombre y los fallos seleccionados.');
    } finally {
      setSaving(false);
    }
  };

  const updateSaved = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !savedId || requestedSlugs.length < 2) return;
    setUpdating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.patch<ApiResponse<SavedTimeline>>(`/research/timelines/${savedId}`, {
        name: name.trim(),
        description: description.trim() || null,
        slugs: requestedSlugs,
      });
      setSavedTimelineState({ id: savedId, status: 'ready', data: response.data });
      selection.replace(response.data.slugs.map((slug) => ({ slug, title: titleBySlug.get(slug) || `Fallo ${slug}` })));
      setNotice('Espacio de evolución actualizado.');
    } catch {
      setError('No se pudo actualizar el espacio de evolución.');
    } finally {
      setUpdating(false);
    }
  };

  const deleteSaved = async () => {
    if (!savedId) return;
    try {
      await api.delete(`/research/timelines/${savedId}`);
      selection.clear();
      setNotice('Espacio de evolución eliminado. Los fallos originales no se modificaron.');
      router.push('/evolucion');
    } catch {
      setError('No se pudo eliminar el espacio de evolución.');
    }
  };

  const copyPublicLink = async () => {
    if (savedId || requestedSlugs.length < 2) return;
    setCopyingLink(true);
    const path = publicEvolutionHref(requestedSlugs);
    if (path === '/evolucion') {
      setNotice('La selección es demasiado extensa para un enlace público. Guardala en tu cuenta para volver a abrirla.');
      setCopyingLink(false);
      return;
    }
    const href = `${window.location.origin}${path}`;
    const copied = await copyToClipboard(href);
    setNotice(copied ? 'Enlace reproducible copiado. Incluye únicamente identificadores públicos.' : 'El navegador no permitió copiar el enlace.');
    setCopyingLink(false);
  };

  const exportResearch = async () => {
    if (!savedId || !savedTimeline) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const blob = await api.download(`/research/timelines/${savedId}/export`, {
        method: 'POST',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `galilei-evolucion-${savedId}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice('Investigación exportada. El ZIP incluye un manifest.json verificable.');
    } catch {
      setError('No se pudo exportar la investigación. Revisá el acceso al espacio e intentá nuevamente.');
    } finally {
      setExporting(false);
    }
  };

  const toggleCompare = (slug: string) => {
    setCompareMessage(null);
    if (compareSlugs.includes(slug)) {
      setCompareSlugs(compareSlugs.filter((item) => item !== slug));
      return;
    }
    if (compareSlugs.length >= 4) {
      setCompareMessage('Comparar fallos admite hasta cuatro elementos.');
      return;
    }
    setCompareSlugs([...compareSlugs, slug]);
  };

  const openComparison = () => {
    if (compareSlugs.length < 2 || compareSlugs.length > 4) return;
    router.push(`/comparar?ids=${compareSlugs.map(encodeURIComponent).join(',')}`);
  };

  const copyCitation = async (citation: string) => {
    const copied = await copyToClipboard(citation);
    setNotice(copied ? 'Cita copiada.' : 'El navegador no permitió copiar la cita.');
  };

  if (savedTimelineLoading || (savedId && authLoading)) return <LoadingSpinner label="Cargando espacio de evolución…" />;

  return (
    <main className={styles.page}>
      <div className={styles.topActions}>
        <Link href={savedId ? '/evolucion' : '/consulta'}><Button variant="ghost">{savedId ? 'Volver a evolución' : 'Volver a búsqueda'}</Button></Link>
        {!savedId ? <Button variant="secondary" onClick={() => void copyPublicLink()} disabled={requestedSlugs.length < 2 || copyingLink}>{copyingLink ? 'Copiando…' : 'Copiar enlace público'}</Button> : null}
      </div>
      <PageHeader
        title="Evolución jurisprudencial"
        description="Ordená fallos por fecha y revisá citas verificadas o coincidencias exactas de expediente. La pantalla presenta fuentes; la interpretación queda a cargo de quien investiga."
      />
      {error ? <StatusMessage variant="error" title="No se pudo completar" message={error} /> : null}
      {savedTimelineError ? <StatusMessage variant="error" title="Espacio no disponible" message="El espacio de evolución no está disponible." /> : null}
      {resolutionError ? <div className={styles.resolveError} role="alert"><StatusMessage variant="error" title="No se pudo preparar la línea de tiempo" message="Revisá los fallos seleccionados e intentá nuevamente." /><Button variant="secondary" onClick={() => setRetryCount((value) => value + 1)}>Reintentar</Button></div> : null}
      {notice ? <StatusMessage variant="success" title="Listo" message={notice} /> : null}
      {payload?.omittedCount ? <StatusMessage variant="info" title="Fallos omitidos" message={`${payload.omittedCount} fallo(s) no se pudieron incluir por falta de acceso o porque dejaron de estar publicados.`} /> : null}
      {savedTimeline?.omittedCount && !payload ? <StatusMessage variant="info" title="Membresía revalidada" message={`${savedTimeline.omittedCount} referencia(s) ya no están disponibles y se omitieron sin mostrar sus datos.`} /> : null}

      {savedId && savedTimeline ? (
        <Card>
          <form className={styles.savedForm} onSubmit={(event) => void updateSaved(event)}>
            <label htmlFor="timeline-name">Nombre del espacio</label>
            <input id="timeline-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
            <label htmlFor="timeline-description">Descripción privada</label>
            <textarea id="timeline-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} />
            <div className={styles.formActions}>
              <Button type="submit" variant="secondary" disabled={updating || resolving || !name.trim() || requestedSlugs.length < 2}>{updating ? 'Guardando…' : 'Actualizar espacio'}</Button>
              <Button type="button" variant="secondary" onClick={() => void exportResearch()} disabled={exporting || resolving}>{exporting ? 'Preparando dossier…' : 'Exportar investigación'}</Button>
              <details>
                <summary>Eliminar espacio</summary>
                <p>Se eliminará la selección guardada. Los fallos y documentos originales no se modifican.</p>
                <Button type="button" variant="danger" onClick={() => void deleteSaved()}>Eliminar</Button>
              </details>
            </div>
          </form>
        </Card>
      ) : !savedId && user && payload && publicJudgments.length >= 2 ? (
        <Card>
          <form className={styles.savedForm} onSubmit={(event) => void saveNew(event)}>
            <strong>Guardar espacio privado</strong>
            <label htmlFor="timeline-name">Nombre del espacio</label>
            <input id="timeline-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ej. Responsabilidad del Estado" required />
            <label htmlFor="timeline-description">Descripción privada (opcional)</label>
            <textarea id="timeline-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} placeholder="Contexto de investigación, sin conclusiones automáticas" />
            <Button type="submit" variant="secondary" disabled={saving || !name.trim()}>{saving ? 'Guardando…' : 'Guardar en mi cuenta'}</Button>
          </form>
        </Card>
      ) : null}

      {!savedId && user ? (
        <Card>
          <details>
            <summary>Mis espacios guardados</summary>
            {savedListLoading ? <p role="status">Cargando espacios guardados…</p> : savedTimelines.length ? (
              <ul className={styles.savedList}>
                {savedTimelines.map((item) => (
                  <li key={item.id}>
                    <span><strong>{item.name}</strong><small>{item.itemCount ?? item.slugs?.length ?? 0} fallos · actualizado {formatDate(item.updatedAt)}</small></span>
                    <Link href={`/evolucion/guardada/${item.id}`}><Button variant="ghost">Abrir</Button></Link>
                  </li>
                ))}
              </ul>
            ) : <p>Todavía no guardaste espacios de evolución.</p>}
          </details>
        </Card>
      ) : null}

      {savedId && !user && !authLoading ? <StatusMessage variant="info" title="Espacio privado" message="Iniciá sesión con la cuenta propietaria para ver este espacio guardado." /> : null}
      {!savedId && requestedFromUrl !== null && parsedUrlSlugs === null ? <StatusMessage variant="error" title="Enlace no válido" message="El enlace debe contener entre 2 y 50 fallos públicos distintos." /> : null}
      {!resolving && !error && requestedSlugs.length < 2 ? (
        <EmptyState title="Seleccioná al menos dos fallos" description="Agregalos desde la búsqueda, una colección, favoritos, una ficha pública o Comparar fallos. La selección se conserva mientras navegás." />
      ) : null}
      {resolving ? <LoadingSpinner label="Preparando línea de tiempo y vínculos verificados…" /> : null}

      {payload && publicJudgments.length > 0 ? (
        <>
          <section className={styles.toolbar} aria-label="Controles de línea de tiempo">
            <label htmlFor="timeline-sala">Sala</label>
            <select id="timeline-sala" value={selectedSala} onChange={(event) => setSelectedSala(event.target.value)}>
              <option value="ALL">Todas las salas</option>
              {salas.map((sala) => <option key={sala} value={sala}>{sala.toLowerCase().startsWith('sala') ? sala : `Sala ${sala}`}</option>)}
            </select>
            <span>{visibleJudgments.length} de {publicJudgments.length} fallos visibles</span>
            <Button variant="secondary" onClick={openComparison} disabled={compareSlugs.length < 2 || compareSlugs.length > 4}>Comparar {compareSlugs.length ? `${compareSlugs.length} seleccionados` : '2–4 fallos'}</Button>
            {compareMessage ? <span className={styles.inlineMessage} role="status">{compareMessage}</span> : null}
          </section>

          <section className={styles.timeline} aria-label="Línea de tiempo de fallos seleccionados">
            {groups.map((group) => (
              <section className={styles.yearGroup} key={group.year ?? 'undated'} aria-label={group.year === null ? 'Sin fecha disponible' : `Año ${group.year}`}>
                <h2>{group.year === null ? 'Sin fecha disponible' : group.year}</h2>
                <ol>
                  {group.events.map((judgment) => (
                    <li key={judgment.slug}>
                      <article className={styles.event}>
                        <div className={styles.dateMarker}>{judgment.decisionDate ? formatDate(judgment.decisionDate) : 'Sin fecha disponible'}</div>
                        <div className={styles.eventBody}>
                          <div className={styles.eventHeading}>
                            <h3><Link href={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}`}>{titleFor(judgment)}</Link></h3>
                            <span className={styles.chamber}>{judgment.sala ? (judgment.sala.toLowerCase().startsWith('sala') ? judgment.sala : `Sala ${judgment.sala}`) : 'Sin Sala informada'}</span>
                          </div>
                          <p className={styles.citation}>{judgment.cita}</p>
                          <p className={styles.metadata}>
                            {[judgment.numeroSentencia ? `Sentencia ${judgment.numeroSentencia}` : null, judgment.tipoFallo, judgment.expediente ? `Expte. ${judgment.expediente}` : null, `${judgment.sumarioCount} sumarios publicados`, `${judgment.verifiedCitesCount} citas verificadas · citado ${judgment.verifiedCitedByCount} vez/veces`].filter(Boolean).join(' · ')}
                          </p>
                          <div className={styles.eventActions}>
                            <Link href={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}`}><Button variant="secondary">Abrir fallo</Button></Link>
                            {judgment.hasPdf ? <Link href={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}/documento`}><Button variant="ghost">Ver PDF</Button></Link> : null}
                            <Button variant="ghost" onClick={() => void copyCitation(judgment.cita)}>Copiar cita</Button>
                            <Button variant="ghost" aria-pressed={compareSlugs.includes(judgment.slug)} onClick={() => toggleCompare(judgment.slug)}>{compareSlugs.includes(judgment.slug) ? 'Quitar de comparación' : 'Seleccionar para comparar'}</Button>
                          {judgment.decisionDate && visibleJudgments[visibleJudgments.findIndex((item) => item.slug === judgment.slug) + 1]?.decisionDate ? (
                            <Button variant="ghost" onClick={() => {
                              const index = visibleJudgments.findIndex((item) => item.slug === judgment.slug);
                              const next = visibleJudgments[index + 1];
                              if (next) router.push(`/comparar?ids=${encodeURIComponent(judgment.slug)},${encodeURIComponent(next.slug)}`);
                            }}>Comparar con el siguiente</Button>
                          ) : null}
                            <Button variant="ghost" onClick={() => selection.toggle({ slug: judgment.slug, title: titleFor(judgment) })}>Quitar de evolución</Button>
                          </div>
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </section>

          <section className={styles.relations} aria-labelledby="evolution-relations-title">
            <h2 id="evolution-relations-title">Relaciones verificadas en la selección</h2>
            {payload.verifiedCitationEdges.length || payload.sameExpedienteGroups.length ? (
              <ul>
                {payload.verifiedCitationEdges.map((edge, index) => (
                  <li key={`${edge.sourceSlug}-${edge.targetSlug}-${index}`}>
                    <div className={styles.relationMap}>
                      <span>{titleBySlug.get(edge.sourceSlug) || edge.sourceSlug}</span><span className={styles.arrow} aria-hidden="true">→</span><span>{titleBySlug.get(edge.targetSlug) || edge.targetSlug}</span>
                    </div>
                    <p><strong>{titleBySlug.get(edge.sourceSlug) || edge.sourceSlug} cita verificadamente a {titleBySlug.get(edge.targetSlug) || edge.targetSlug}.</strong> Evidencia: {edge.evidence}{edge.page ? <> · pág. <Link href={`/consulta/sentencia/${encodeURIComponent(edge.sourceSlug)}/documento?page=${edge.page}`}>{edge.page}</Link></> : null}</p>
                  </li>
                ))}
                {payload.sameExpedienteGroups.map((group) => (
                  <li key={`${group.expediente}-${group.slugs.join(',')}`}>
                    <div className={styles.sameCase}><strong>Mismo expediente {group.expediente}</strong>{group.slugs.map((slug) => <span key={slug}>{titleBySlug.get(slug) || slug}</span>)}</div>
                    <p>La coincidencia usa la normalización exacta del expediente y conserva el año; no combina expedientes parciales ni años distintos.</p>
                  </li>
                ))}
              </ul>
            ) : <p>No hay relaciones verificadas entre los fallos visibles. Las citas detectadas pendientes de revisión no se muestran como verificadas.</p>}
            {payload.truncatedCitationEvidence ? <p role="status">La lista de evidencia de citas alcanzó el límite de seguridad; los fallos siguen disponibles en la línea de tiempo.</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
