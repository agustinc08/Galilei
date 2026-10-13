'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { CorpusPdfViewer, type PdfMatch } from '@/app/(admin)/corpus/[id]/CorpusPdfViewer';

type DocumentInfo = { id: string; title: string; status: string; file: { filename: string; pageCount?: number | null; mimeType: string } | null; extraction: { status: string; pageCount: number } | null };
type Matches = { total: number; truncated: boolean; matches: Array<PdfMatch & { context: string; total: number }> };

export default function WorkspaceDocumentViewer() {
  const params = useParams<{ workspaceId: string; id: string }>();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<Matches | null>(null);
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page') ?? 1)));
  const [pageCount, setPageCount] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true; let objectUrl: string | null = null;
    void Promise.all([
      api.get<DocumentInfo>(`/workspaces/${params.workspaceId}/documents/${params.id}`),
      api.download(`/workspaces/${params.workspaceId}/documents/${params.id}/file`),
    ]).then(([info, blob]) => { if (!alive) return; objectUrl = URL.createObjectURL(blob); setDocument(info); setPdf(objectUrl); })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el documento privado.'); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [params.workspaceId, params.id]);

  async function findMatches() {
    if (!query.trim()) { setMatches(null); return; }
    try { const data = await api.get<Matches>(`/workspaces/${params.workspaceId}/documents/${params.id}/matches`, { query: { q: query } }); setMatches(data); setActive(0); if (data.matches[0]) setPage(data.matches[0].page); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo buscar dentro del documento.'); }
  }
  async function downloadPdf() {
    try {
      const blob = await api.download(`/workspaces/${params.workspaceId}/documents/${params.id}/file?download=true`);
      downloadBlob(blob, document?.file?.filename ?? 'documento.pdf');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar el PDF privado.');
    }
  }
  useEffect(() => { if (initialQuery) void findMatches(); }, [params.workspaceId, params.id]);

  const current = matches?.matches[active];
  return <>
    <Link href="/spaces">← Mi espacio</Link>
    <PageHeader title={document?.title ?? 'Documento privado'} description={document?.file?.filename ?? 'Visor con acceso controlado por workspace'} />
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    {document?.status === 'OCR_REQUIRED' && <Card><p>El PDF está disponible para lectura. No se incluyó en búsqueda porque requiere OCR.</p></Card>}
    <Card><form onSubmit={(event) => { event.preventDefault(); void findMatches(); }}><input aria-label="Buscar en el documento" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar y resaltar en el PDF" /><button>Buscar</button></form>
      {matches && <p>{matches.total} coincidencias{matches.truncated ? ' (muestra truncada)' : ''} {current && `· página ${current.page}`}</p>}
      {matches?.matches.length ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button onClick={() => { const next = (active + matches.matches.length - 1) % matches.matches.length; setActive(next); setPage(matches.matches[next].page); }}>Anterior</button><button onClick={() => { const next = (active + 1) % matches.matches.length; setActive(next); setPage(matches.matches[next].page); }}>Siguiente</button><span>{current?.context}</span></div> : null}
    </Card>
    <Card><div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Página anterior</button><span>Página {page} de {pageCount || document?.extraction?.pageCount || '?'}</span><button disabled={!!pageCount && page >= pageCount} onClick={() => setPage((value) => value + 1)}>Página siguiente</button><button onClick={() => void downloadPdf()}>Descargar PDF</button></div>{pdf ? <CorpusPdfViewer file={pdf} page={page} matches={matches?.matches ?? []} activeMatch={active} onLoadSuccess={setPageCount} /> : <p>Cargando PDF…</p>}</Card>
  </>;
}
