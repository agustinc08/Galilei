'use client';

import { useState } from 'react';
import { Link } from "@/lib/router-compat";
import { usePathname, useSearchParams } from '@/lib/router-compat';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { HighlightText } from './HighlightText';
import type { ConsultaPublicaResultado } from '@/types/busqueda';
import { trackEvento } from '@/lib/tracking';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { api } from '@/lib/api';
import { buildApiUrl } from '@/lib/env';
import { htmlToPlainText } from '@/lib/html-to-plain-text';
import { copyToClipboard } from '@/lib/utils';
import type { PublicSentencia } from '@/types/sentencia';
import { AddToCollectionButton } from '@/components/research/AddToCollectionButton';
import { useComparisonSelection } from '@/components/comparison/ComparisonSelection';
import { EvolutionAddButton } from '@/components/evolution/EvolutionAddButton';
import { highlightSearchSnippet } from '@/lib/search-snippet-highlight';

type PublicPdfMatch = {
  pageNumber: number;
  context: string;
  textKind: 'NATIVE' | 'OCR';
};

type PublicPdfMatchesResponse = {
  status: 'MATCHES' | 'NO_MATCH' | 'NO_TEXT';
  total: number;
  matches: PublicPdfMatch[];
};

type PdfMatchLookupState = {
  key: string;
  status: 'loading' | 'results' | 'message';
  matches?: PublicPdfMatch[];
  total?: number;
  message?: string;
};

type Props = {
  item: ConsultaPublicaResultado;
  selected: boolean;
  onToggle: (id: number) => void;
  onMissingPdf: () => void;
  query?: string;
  canFavorite?: boolean;
  favorite?: boolean;
  favoriteReady?: boolean;
  favoritePending?: boolean;
  onToggleFavorite?: (id: number) => void | Promise<void>;
  canAddToCollection?: boolean;
};

export function ConsultaResultadoCard({
  item,
  selected,
  onToggle,
  onMissingPdf,
  query,
  canFavorite = false,
  favorite = false,
  favoriteReady = true,
  favoritePending = false,
  onToggleFavorite,
  canAddToCollection = false,
}: Props) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyingCitation, setCopyingCitation] = useState(false);
  const [pdfMatchLookup, setPdfMatchLookup] = useState<PdfMatchLookupState | null>(null);
  const comparison = useComparisonSelection();
  const pathname = usePathname() ?? '/consulta';
  const searchParams = useSearchParams();
  const internalSearch = pathname === '/busqueda' || pathname.startsWith('/busqueda/');
  const searchPath = internalSearch ? '/busqueda' : '/consulta';
  const returnTo = `${searchPath}${searchParams.size ? `?${searchParams.toString()}` : ''}`;
  const detailQuery = new URLSearchParams({ returnTo });
  if (query) detailQuery.set('q', query);
  const pdfMatchLookupKey = `${item.id}\u0000${query ?? ''}`;
  const activePdfMatchLookup = pdfMatchLookup?.key === pdfMatchLookupKey
    ? pdfMatchLookup
    : null;
  const locatingMatches = activePdfMatchLookup?.status === 'loading';
  const locatedMatches = activePdfMatchLookup?.status === 'results'
    ? activePdfMatchLookup.matches ?? null
    : null;
  const locatedMatchTotal = activePdfMatchLookup?.status === 'results'
    ? activePdfMatchLookup.total ?? 0
    : 0;
  const locateMessage = activePdfMatchLookup?.status === 'message'
    ? activePdfMatchLookup.message ?? null
    : null;
  const publicIdentifier = item.slugPublico ?? String(item.sentenciaId ?? item.id);
  const hasPdf = item.pdfDisponible === true || Boolean(item.archivoPdfId);
  const summaryCount = Math.max(1, Math.trunc(Number(item.cantidadSumarios ?? 1)));
  const inComparison = Boolean(item.slugPublico && comparison.items.some((candidate) => candidate.slug === item.slugPublico));
  const detailHref = publicIdentifier
    ? `${internalSearch ? '/busqueda/sentencia' : '/consulta/sentencia'}/${publicIdentifier}?${detailQuery.toString()}#sumarios`
    : null;
  const documentHref = publicIdentifier ? `/fallos/${publicIdentifier}?${detailQuery.toString()}` : null;
  const pdfHref = hasPdf
    ? buildApiUrl(`/public/sentencias/${encodeURIComponent(publicIdentifier)}/pdf`)
    : null;

  const locatePdfMatches = async () => {
    if (!item.slugPublico || !query?.trim() || locatingMatches) return;
    const requestKey = pdfMatchLookupKey;
    setPdfMatchLookup({ key: requestKey, status: 'loading' });
    try {
      const response = await api.get<{ data: PublicPdfMatchesResponse }>(
        `/public/sentencias/${encodeURIComponent(item.slugPublico)}/coincidencias`,
        { query: { q: query.trim() }, skipAuth: true },
      );
      const result = response.data;
      if (result.status === 'NO_TEXT') {
        setPdfMatchLookup({
          key: requestKey,
          status: 'message',
          message: 'El PDF no tiene texto utilizable para ubicar la coincidencia. Podés abrirlo igualmente.',
        });
      } else if (result.status === 'NO_MATCH' || !result.matches.length) {
        setPdfMatchLookup({
          key: requestKey,
          status: 'message',
          message: 'La búsqueda no coincide con el texto disponible del PDF. Podés abrirlo igualmente.',
        });
      } else {
        const matchesByPage = new Map<number, (typeof result.matches)[number]>();
        for (const match of result.matches) {
          if (!matchesByPage.has(match.pageNumber)) {
            matchesByPage.set(match.pageNumber, match);
          }
        }
        const firstMatchPerPage = [...matchesByPage.values()];
        setPdfMatchLookup({
          key: requestKey,
          status: 'results',
          matches: firstMatchPerPage,
          total: result.total,
        });
      }
    } catch {
      setPdfMatchLookup({
        key: requestKey,
        status: 'message',
        message: 'No pudimos ubicar la coincidencia en este momento. Podés abrir el PDF y buscar allí.',
      });
    }
  };

  const openPdfAtMatch = (pageNumber: number) => {
    if (!documentHref) return;
    const destination = new URL(documentHref, window.location.origin);
    destination.searchParams.set('page', String(pageNumber));
    window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
  };

  const copyCitation = async () => {
    if (!item.slugPublico || copyingCitation) return;
    setCopyingCitation(true);
    setCopyMessage(null);
    try {
      const response = await api.get<{ data: PublicSentencia }>(
        `/public/sentencias/${encodeURIComponent(item.slugPublico)}`,
        { skipAuth: true },
      );
      const citation = response.data.cita?.citaCopiable?.trim();
      if (!citation) {
        setCopyMessage('La ficha pública no incluye una cita copiable.');
        return;
      }
      const sourceUrl = `${window.location.origin}/consulta/sentencia/${encodeURIComponent(item.slugPublico)}`;
      const copied = await copyToClipboard(`${citation}\nFuente: Jurisprudencia Civil — ${sourceUrl}`);
      setCopyMessage(copied ? 'Cita y enlace de Jurisprudencia Civil copiados.' : 'El navegador no permitió copiar. Seleccioná y copiá el texto desde la ficha del fallo.');
    } catch {
      setCopyMessage('No pudimos obtener la cita pública de este fallo.');
    } finally {
      setCopyingCitation(false);
    }
  };

  return (
    <article
      className={`${styles.resultCard} ${selected ? styles.resultCardSelected : ''}`}
    >
      <div className={styles.resultMain}>
        <div className={styles.badges}>
          <span className={styles.badge}>{item.esFalloCorpus ? 'Fallo civil' : 'Sumario'}</span>
          {item.numeroSumario ? <span className={styles.badge}>Nº {item.numeroSumario}</span> : null}
          {hasPdf ? <span className={styles.badge}>PDF disponible</span> : null}
          {!hasPdf ? <span className={styles.badgeMuted}>Sin PDF</span> : null}
          {!item.esFalloCorpus && summaryCount > 1 ? <span className={styles.summaryCount}>{summaryCount} sumarios en este fallo</span> : null}
        </div>

        <h2 className={styles.resultTitle}>
          {detailHref ? <Link href={detailHref}>{item.caratula || item.expediente || item.numeroSentencia || 'Fallo sin carátula'}</Link> : (item.caratula || item.expediente || item.numeroSentencia || 'Fallo sin carátula')}
        </h2>
        <p className={styles.resultMeta}>
          {[item.sala ? (item.sala.toLowerCase().startsWith('sala') ? item.sala : `Sala ${item.sala}`) : 'Sin Sala informada', formatDate(item.fecha), formatTipoFallo(item.tipoFallo), item.expediente ? `Expte. ${item.expediente}` : null, item.numeroSentencia ? `Sentencia ${item.numeroSentencia}` : null]
            .filter(Boolean).join(' · ')}
        </p>
        {item.magistrados ? <p className={styles.resultJudges}><strong>Magistrados:</strong> {item.magistrados}</p> : null}

        <div className={styles.sumarioBox}>
          <div className={styles.sumarioHeading}>
            <span>SUMARIO</span>
            <strong className={styles.theme}>{item.esFalloCorpus ? 'Extracto del fallo' : (item.tema || 'Sumario')}</strong>
          </div>
          <p className={styles.sumarioText}>{htmlToPlainText(item.esFalloCorpus ? item.extractoFallo : item.textoSumario)}</p>
        </div>

        {item.highlights.length > 0 ? (
          <div className={styles.highlightGroup}>
            {item.highlights.map((highlight) => (
              <div key={`${item.id}-${highlight.campo}-${highlight.texto}`}>
                <div className={styles.highlightLabel}>{highlight.campo}</div>
                <HighlightText html={highlight.texto} />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className={styles.resultAside}>
        <div className={styles.primaryResultActions}>
          {detailHref ? (
            <Link href={detailHref}>
              <Button variant="secondary">{item.esFalloCorpus ? 'Ver fallo' : summaryCount > 1 ? `Ver ${summaryCount} sumarios` : 'Ver sumario'}</Button>
            </Link>
          ) : null}
          {documentHref && hasPdf ? (
            <Link href={documentHref} onClick={() => void trackEvento({ tipoEvento: 'view_documento', metadata: { origen: 'consulta', slug: publicIdentifier } }, { publicOnly: true })}>
              <Button>Ver fallo</Button>
            </Link>
          ) : null}
          {pdfHref && hasPdf ? <a className={styles.pdfAction} href={pdfHref} target="_blank" rel="noreferrer">Abrir PDF</a> : null}
        </div>
        {!internalSearch && item.slugPublico && hasPdf && query?.trim() ? (
          <div className={styles.highlightGroup}>
            {locatedMatches ? (
              <div role="status">
                <strong className={styles.highlightLabel}>
                  {locatedMatchTotal === 1 ? 'Coincidencia en el PDF' : `${locatedMatchTotal} coincidencias en el PDF`}
                </strong>
                <p className={styles.sumarioText}>
                  {highlightSearchSnippet(locatedMatches[0]?.context ?? '', { query })}
                </p>
                <div className={styles.primaryResultActions}>
                  {locatedMatches.slice(0, 5).map((match) => (
                    <Button
                      key={match.pageNumber}
                      variant="secondary"
                      onClick={() => openPdfAtMatch(match.pageNumber)}
                    >
                      Ir a página PDF {match.pageNumber}
                    </Button>
                  ))}
                </div>
                {locatedMatchTotal > locatedMatches.length ? (
                  <small>Se muestran las primeras {locatedMatches.length} páginas con coincidencias.</small>
                ) : null}
              </div>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void locatePdfMatches()}
                  disabled={locatingMatches}
                >
                  {locatingMatches ? 'Buscando en el texto disponible…' : 'Localizar en el PDF'}
                </Button>
                {locateMessage ? <p role="status">{locateMessage}</p> : null}
              </>
            )}
          </div>
        ) : null}
        {!hasPdf ? <Button variant="secondary" onClick={onMissingPdf}>Por qué no hay PDF</Button> : null}
        <details className={styles.moreResultActions}>
          <summary>Más acciones</summary>
          <div>
            {canFavorite && onToggleFavorite ? (
              <FavoriteButton
                active={favorite}
                onToggle={() => onToggleFavorite(item.sentenciaId ?? item.id)}
                disabled={favoritePending || !favoriteReady}
              />
            ) : null}
            {canAddToCollection ? <AddToCollectionButton sentenciaId={item.sentenciaId ?? item.id} /> : null}
            {item.slugPublico ? (
              <Button variant={inComparison ? 'secondary' : 'ghost'} onClick={() => comparison.toggle({ slug: item.slugPublico!, title: item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.id}` })}>
                {inComparison ? 'Quitar de comparación' : 'Agregar a comparación'}
              </Button>
            ) : null}
            {item.slugPublico ? <EvolutionAddButton slug={item.slugPublico} title={item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.id}`} /> : null}
            {item.slugPublico ? (
              <Button variant="ghost" onClick={() => void copyCitation()} disabled={copyingCitation}>
                {copyingCitation ? 'Copiando cita…' : 'Copiar cita'}
              </Button>
            ) : null}
            <Button
              variant={selected ? 'secondary' : 'ghost'}
              className={styles.printSelect}
              onClick={() => onToggle(item.id)}
            >
              {selected ? 'Quitar de impresión' : 'Seleccionar para imprimir'}
            </Button>
          </div>
        </details>
        {copyMessage ? <span role="status" className={styles.mutedText}>{copyMessage}</span> : null}
      </aside>
    </article>
  );
}
