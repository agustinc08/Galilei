'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useRouter, useSearchParams } from '@/lib/router-compat';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useComparisonSelection } from '@/components/comparison/ComparisonSelection';
import { useEvolutionSelection } from '@/components/evolution/EvolutionSelection';
import { PdfViewer } from '@/components/documento/PdfViewer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { copyToClipboard, formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import type { ApiResponse } from '@/types/common';
import styles from './comparar.module.css';

type ComparedJudgment = {
  slug: string;
  caratula: string | null;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  fecha: string | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  objeto: string | null;
  actor: string | null;
  demandado: string | null;
  magistrados: string | null;
  juez: string | null;
  resenaEditorial: string | null;
  resumenAi: string | null;
  resumenAiFuente: string | null;
  sumarios: Array<{ id: number; numeroSumario: string | null; tema: string | null; texto: string }>;
  hasPdf: boolean;
  verifiedCitesCount: number;
  verifiedCitedByCount: number;
  sameExpedienteAs: string[];
};

type CrossCitation = {
  sourceSlug: string;
  targetSlug: string;
  rawCitation: string;
  page: number | null;
};

type ComparisonPayload = { judgments: ComparedJudgment[]; verifiedCrossCitations: CrossCitation[] };
type SavedComparison = { id: number; name: string; slugs: string[]; updatedAt: string };
type OwnedNote = { slug: string; collectionName: string; note: string };

function parseIds(raw: string | null) {
  if (!raw) return [];
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(id))) return [];
  return ids;
}

function display(value: string | null | undefined) {
  return value?.trim() || '—';
}

export default function JudgmentComparisonPage() {
  const query = useSearchParams();
  const router = useRouter();
  const idsValue = query.get('ids');
  const ids = useMemo(() => parseIds(idsValue), [idsValue]);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const selection = useComparisonSelection();
  const evolutionSelection = useEvolutionSelection();
  const replaceSelection = selection.replace;
  const [comparison, setComparison] = useState<ComparisonPayload | null>(null);
  const [notesState, setNotesState] = useState<{ ownerId: number; idsKey: string; data: OwnedNote[] } | null>(null);
  const [savedState, setSavedState] = useState<{ ownerId: number; data: SavedComparison[] } | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [activePdfSlug, setActivePdfSlug] = useState<string | null>(null);
  const idsKey = ids.join(',');
  const notes = notesState?.ownerId === userId && notesState.idsKey === idsKey ? notesState.data : [];
  const saved = savedState?.ownerId === userId ? savedState.data : [];
  const invalidSelection = ids.length < 2;

  useEffect(() => {
    let active = true;
    if (ids.length < 2) return () => { active = false; };
    void Promise.resolve().then(() => {
      if (!active) return null;
      setLoading(true);
      setError(null);
      return api.get<ApiResponse<ComparisonPayload>>('/research/comparisons/resolve', {
        skipAuth: true,
        query: { ids: ids.join(',') },
      });
    }).then((response) => {
      if (!active || !response) return;
      setComparison(response.data);
      setActivePdfSlug(response.data.judgments[0]?.slug ?? null);
      replaceSelection(response.data.judgments.map((item) => ({
        slug: item.slug,
        title: item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.slug}`,
      })));
    }).catch(() => {
      if (active) {
        setComparison(null);
        setError('La comparación no está disponible. Algún fallo dejó de ser público o la dirección no es válida.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids, replaceSelection]);

  useEffect(() => {
    let active = true;
    if (userId === null || ids.length < 2) return () => { active = false; };
    void api.get<ApiResponse<OwnedNote[]>>('/research/comparisons/notes', { query: { slugs: ids.join(',') } })
      .then((response) => { if (active) setNotesState({ ownerId: userId, idsKey, data: response.data }); })
      .catch(() => { if (active) setNotesState({ ownerId: userId, idsKey, data: [] }); });
    return () => { active = false; };
  }, [userId, ids, idsKey]);

  const loadSaved = useCallback(async () => {
    if (userId === null) return;
    try {
      const response = await api.get<ApiResponse<SavedComparison[]>>('/research/comparisons');
      setSavedState({ ownerId: userId, data: response.data });
    } catch {
      setSavedState({ ownerId: userId, data: [] });
    }
  }, [userId]);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void api.get<ApiResponse<SavedComparison[]>>('/research/comparisons')
      .then((response) => { if (active) setSavedState({ ownerId: userId, data: response.data }); })
      .catch(() => { if (active) setSavedState({ ownerId: userId, data: [] }); });
    return () => { active = false; };
  }, [userId]);

  const judgments = useMemo(() => comparison?.judgments ?? [], [comparison]);
  const judgmentBySlug = useMemo(() => new Map(judgments.map((item) => [item.slug, item])), [judgments]);
  const returnToSearch = () => router.push(selection.returnTo || '/consulta');

  const openEvolution = () => {
    const next = [...evolutionSelection.items, ...judgments.map((item) => ({
      slug: item.slug,
      title: item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.slug}`,
    }))];
    const unique = [...new Map(next.map((item) => [item.slug, item])).values()].slice(0, 50);
    evolutionSelection.replace(unique);
    router.push(`/evolucion?ids=${unique.map((item) => encodeURIComponent(item.slug)).join(',')}`);
  };

  const toggleCurrent = (judgment: ComparedJudgment) => {
    const next = judgments.filter((item) => item.slug !== judgment.slug);
    if (next.length < 2) {
      selection.replace(next.map((item) => ({ slug: item.slug, title: item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.slug}` })));
      router.push(selection.returnTo || '/consulta');
      return;
    }
    const params = new URLSearchParams({ ids: next.map((item) => item.slug).join(',') });
    router.push(`/comparar?${params.toString()}`);
  };

  const copyCitation = async (judgment: ComparedJudgment) => {
    setMessage(null);
    try {
      const response = await api.get<ApiResponse<{ citaCopiable?: string }>>(
        `/public/sentencias/${encodeURIComponent(judgment.slug)}/cita`,
        { skipAuth: true },
      );
      if (!response.data.citaCopiable) throw new Error('missing citation');
      const copied = await copyToClipboard(response.data.citaCopiable);
      setMessage(copied ? 'Cita copiada desde la ficha pública.' : 'El navegador no permitió copiar la cita.');
    } catch {
      setMessage('No se pudo obtener la cita pública de este fallo.');
    }
  };

  const saveComparison = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || judgments.length < 2) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.post('/research/comparisons', { name: name.trim() || 'Comparación de fallos', slugs: judgments.map((item) => item.slug) });
      setName('');
      setMessage('Comparación guardada en tu cuenta.');
      await loadSaved();
    } catch {
      setError('No se pudo guardar la comparación. Revisá tu sesión e intentá nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  const openSaved = async (id: number) => {
    try {
      const response = await api.get<ApiResponse<SavedComparison>>(`/research/comparisons/${id}`);
      const savedComparison = response.data;
      router.push(`/comparar?ids=${encodeURIComponent(savedComparison.slugs.join(','))}`);
    } catch {
      setError('La comparación guardada ya no está disponible.');
      await loadSaved();
    }
  };

  const deleteSaved = async (id: number) => {
    try {
      await api.delete(`/research/comparisons/${id}`);
      setMessage('Comparación eliminada. Los fallos originales no se modificaron.');
      await loadSaved();
    } catch {
      setError('No se pudo eliminar la comparación.');
    }
  };

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('ids', judgments.map((item) => item.slug).join(','));
    const copied = await copyToClipboard(url.toString());
    setMessage(copied ? 'Enlace público de comparación copiado.' : 'El navegador no permitió copiar el enlace.');
  };

  const rows: Array<{ label: string; values: Array<ReactNode>; raw: string[] }> = [
    { label: 'Sala', values: judgments.map((item) => display(item.sala)), raw: judgments.map((item) => item.sala ?? '') },
    { label: 'Fecha', values: judgments.map((item) => formatDate(item.fecha)), raw: judgments.map((item) => item.fecha ?? '') },
    { label: 'Número de sentencia', values: judgments.map((item) => display(item.numeroSentencia)), raw: judgments.map((item) => item.numeroSentencia ?? '') },
    { label: 'Expediente', values: judgments.map((item) => display(item.expediente)), raw: judgments.map((item) => item.expediente ?? '') },
    { label: 'Tipo de fallo', values: judgments.map((item) => formatTipoFallo(item.tipoFallo)), raw: judgments.map((item) => item.tipoFallo ?? '') },
    { label: 'Tribunal de origen', values: judgments.map((item) => display(item.tribunalOrigen)), raw: judgments.map((item) => item.tribunalOrigen ?? '') },
    { label: 'Objeto', values: judgments.map((item) => display(item.objeto)), raw: judgments.map((item) => item.objeto ?? '') },
    { label: 'Actor', values: judgments.map((item) => display(item.actor)), raw: judgments.map((item) => item.actor ?? '') },
    { label: 'Demandado', values: judgments.map((item) => display(item.demandado)), raw: judgments.map((item) => item.demandado ?? '') },
    { label: 'Magistrados', values: judgments.map((item) => display(item.magistrados || item.juez)), raw: judgments.map((item) => item.magistrados || item.juez || '') },
    { label: 'Sumarios', values: judgments.map((item) => item.sumarios.length ? <details key={item.slug}><summary>{item.sumarios.length} publicado(s)</summary><ol className={styles.summaryList}>{item.sumarios.map((summary) => <li key={summary.id}><strong>{summary.numeroSumario ? `N.º ${summary.numeroSumario} · ` : ''}{summary.tema || 'Sumario'}</strong><p>{summary.texto}</p></li>)}</ol></details> : 'Sin sumarios publicados'), raw: judgments.map((item) => item.sumarios.map((summary) => `${summary.tema ?? ''}${summary.texto}`).join('|')) },
    { label: 'PDF', values: judgments.map((item) => item.hasPdf ? <Link key={item.slug} href={`/consulta/sentencia/${encodeURIComponent(item.slug)}/documento`}>Disponible · abrir documento</Link> : 'No disponible'), raw: judgments.map((item) => String(item.hasPdf)) },
    { label: 'Reseña editorial', values: judgments.map((item) => item.resenaEditorial || 'Sin reseña editorial publicada'), raw: judgments.map((item) => item.resenaEditorial ?? '') },
    { label: 'Resumen automático', values: judgments.map((item) => item.resumenAi ? <Fragment key={item.slug}><strong>Resumen publicado · {item.resumenAiFuente || 'fuente no indicada'}</strong><p>{item.resumenAi}</p></Fragment> : 'Sin resumen automático publicado'), raw: judgments.map((item) => item.resumenAi ?? '') },
    { label: 'Citas verificadas', values: judgments.map((item) => <span key={item.slug}>Cita a {item.verifiedCitesCount} · Citado por {item.verifiedCitedByCount}</span>), raw: judgments.map((item) => `${item.verifiedCitesCount}/${item.verifiedCitedByCount}`) },
    { label: 'Mismo expediente', values: judgments.map((item) => item.sameExpedienteAs.length ? <span key={item.slug} className={styles.relationPill}>Mismo expediente que {item.sameExpedienteAs.map((slug) => judgmentBySlug.get(slug)?.caratula || judgmentBySlug.get(slug)?.numeroSentencia || slug).join(', ')}</span> : '—'), raw: judgments.map((item) => item.sameExpedienteAs.join('|')) },
    { label: 'Notas de investigación', values: judgments.map((item) => {
      const ownNotes = notes.filter((note) => note.slug === item.slug);
      return ownNotes.length ? <ul className={styles.noteList}>{ownNotes.map((note, index) => <li key={`${note.collectionName}-${index}`}><strong>Nota privada · {note.collectionName}</strong><p>{note.note}</p></li>)}</ul> : 'Sin notas propias en colecciones';
    }), raw: judgments.map((item) => notes.filter((note) => note.slug === item.slug).map((note) => note.note).join('|')) },
  ];

  const visibleRows = rows.filter((row) => row.raw.some(Boolean));
  const resolvedIds = comparison?.judgments.map((item) => item.slug).join(',') ?? '';
  const comparisonMatchesRequest = resolvedIds === idsKey;
  const visiblePdfJudgments = judgments.length === 2
    ? (showPdf ? judgments : [])
    : (showPdf ? judgments.filter((item) => item.slug === activePdfSlug) : []);

  if (!invalidSelection && (loading || (!comparisonMatchesRequest && !error))) return <LoadingSpinner label="Preparando comparación…" />;

  return (
    <main className={styles.page}>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={returnToSearch}>Volver a búsqueda</Button>
        <Button variant="ghost" onClick={openEvolution} disabled={judgments.length < 2}>Añadir fallos a evolución</Button>
        <Button variant="secondary" onClick={() => void copyShareLink()} disabled={judgments.length < 2}>Copiar enlace público</Button>
      </div>
      <PageHeader title="Comparar fallos" description="Revisá lado a lado los datos publicados y las relaciones de cita verificadas. Las diferencias no expresan una valoración jurídica." />
      {invalidSelection ? <StatusMessage variant="error" title="No se pudo completar la comparación" message="Elegí entre dos y cuatro fallos públicos para compararlos." /> : error ? <StatusMessage variant="error" title="No se pudo completar la comparación" message={error} /> : null}
      {message ? <StatusMessage variant="success" title="Listo" message={message} /> : null}
      {invalidSelection || !comparisonMatchesRequest || !comparison || judgments.length < 2 ? (
        <EmptyState title="Seleccioná fallos públicos" description="Agregá entre dos y cuatro fallos desde la búsqueda, una colección, favoritos o la ficha pública." />
      ) : (
        <>
          <div className={styles.notice} role="note">La reseña editorial y el resumen automático se muestran por separado. Sólo aparecen citas con estado verificado; no se infieren contradicciones ni jerarquías entre fallos.</div>
          <div className={styles.documentHeaders}>
            {judgments.map((judgment, index) => (
              <article className={styles.documentHeader} key={judgment.slug}>
                <span className={styles.label}>Fallo {String.fromCharCode(65 + index)}</span>
                <h2>{judgment.caratula || judgment.numeroSentencia || 'Fallo sin carátula'}</h2>
                <p>{[judgment.sala, formatDate(judgment.fecha), judgment.numeroSentencia ? `Sentencia ${judgment.numeroSentencia}` : null, judgment.expediente ? `Expte. ${judgment.expediente}` : null, formatTipoFallo(judgment.tipoFallo)].filter(Boolean).join(' · ')}</p>
                <div className={styles.actions}>
                  <Button variant="ghost" onClick={() => void copyCitation(judgment)}>Copiar cita</Button>
                  <Link href={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}`}><Button variant="secondary">Abrir fallo</Button></Link>
                  <Button variant="ghost" onClick={() => toggleCurrent(judgment)}>Quitar</Button>
                </div>
              </article>
            ))}
          </div>

          <section className={styles.matrixSection} aria-labelledby="comparison-matrix-title">
            <h2 id="comparison-matrix-title">Matriz de investigación</h2>
            <div className={styles.tableWrap}>
              <table className={styles.matrix}>
                <thead><tr><th scope="col">Dato</th>{judgments.map((judgment, index) => <th scope="col" key={judgment.slug}>Fallo {String.fromCharCode(65 + index)}</th>)}</tr></thead>
                <tbody>{visibleRows.map((row) => {
                  const distinct = new Set(row.raw.filter(Boolean)).size > 1;
                  return <tr key={row.label} className={distinct ? styles.different : undefined}><th scope="row">{row.label}{distinct ? <span className={styles.differenceLabel}> · valores distintos</span> : null}</th>{row.values.map((value, index) => <td key={`${row.label}-${judgments[index].slug}`} data-label={`Fallo ${String.fromCharCode(65 + index)}`}>{value}</td>)}</tr>;
                })}</tbody>
              </table>
            </div>
          </section>

          <section className={styles.citationsSection}>
            <h2>Citas verificadas entre estos fallos</h2>
            {comparison.verifiedCrossCitations.length ? (
              <ul>{comparison.verifiedCrossCitations.map((citation, index) => <li key={`${citation.sourceSlug}-${citation.targetSlug}-${index}`}><strong>{judgmentBySlug.get(citation.sourceSlug)?.caratula || citation.sourceSlug} cita a {judgmentBySlug.get(citation.targetSlug)?.caratula || citation.targetSlug}</strong><span>{citation.rawCitation}{citation.page ? ` · pág. ${citation.page}` : ''}</span></li>)}</ul>
            ) : <p>No hay citas verificadas cruzadas entre los fallos de esta selección.</p>}
          </section>

          <section className={styles.viewerSection}>
            <div className={styles.sectionHeading}>
              <div><h2>Documentos PDF</h2><p>La búsqueda dentro de cada PDF se procesa en este dispositivo. Las páginas de distintos fallos no se sincronizan automáticamente.</p></div>
              <Button variant="secondary" onClick={() => setShowPdf((current) => !current)}>{showPdf ? 'Cerrar visor' : judgments.length === 2 ? 'Abrir visor lado a lado' : 'Abrir visor del fallo seleccionado'}</Button>
            </div>
            {judgments.length > 2 ? <div className={styles.actions} role="group" aria-label="Elegir fallo para mostrar en el visor">{judgments.map((judgment, index) => <Button key={judgment.slug} variant={activePdfSlug === judgment.slug ? 'secondary' : 'ghost'} onClick={() => { setActivePdfSlug(judgment.slug); setShowPdf(true); }}>Fallo {String.fromCharCode(65 + index)}</Button>)}</div> : null}
            {showPdf && visiblePdfJudgments.length ? <div className={judgments.length === 2 ? styles.pdfGrid : styles.pdfSingle}>{visiblePdfJudgments.map((judgment) => <section className={styles.pdfCard} key={judgment.slug} aria-label={`Visor PDF de ${judgment.caratula || judgment.slug}`}><h3>{judgment.caratula || judgment.numeroSentencia || judgment.slug}</h3>{judgment.hasPdf ? <PdfViewer downloadPath={`/public/sentencias/${encodeURIComponent(judgment.slug)}/pdf`} filename={`${judgment.slug}.pdf`} skipAuth title={judgment.caratula || `Fallo ${judgment.slug}`} citationPath={`/public/sentencias/${encodeURIComponent(judgment.slug)}/cita`} structurePath={`/public/sentencias/${encodeURIComponent(judgment.slug)}/estructura`} pageLinkPath={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}/documento`} syncPageToUrl={false} /> : <p>Este fallo no tiene un PDF público disponible.</p>}<Link href={`/consulta/sentencia/${encodeURIComponent(judgment.slug)}/documento`}><Button variant="ghost">Abrir página completa del documento</Button></Link></section>)}</div> : null}
          </section>

          {user ? (
            <section className={styles.savedSection}>
              <h2>Guardar y volver a abrir</h2>
              <form className={styles.saveForm} onSubmit={(event) => void saveComparison(event)}>
                <label htmlFor="comparison-name">Nombre de esta comparación</label>
                <input id="comparison-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Ej.: Daño moral · criterios por Sala" />
                <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar comparación'}</Button>
              </form>
              {saved.length ? <ul className={styles.savedList}>{saved.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.slugs.length} fallos · actualizado {formatDate(item.updatedAt)}</span></div><div className={styles.actions}><Button variant="secondary" onClick={() => void openSaved(item.id)}>Abrir</Button><Button variant="ghost" onClick={() => void deleteSaved(item.id)}>Eliminar</Button></div></li>)}</ul> : <p>Aún no guardaste comparaciones.</p>}
            </section>
          ) : <p className={styles.authHint}>Podés compartir el enlace porque sólo contiene identificadores públicos. Iniciá sesión para guardar una comparación y consultar las notas privadas de tus colecciones.</p>}
        </>
      )}
    </main>
  );
}
