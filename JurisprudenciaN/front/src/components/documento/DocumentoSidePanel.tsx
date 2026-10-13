'use client';

import styles from './documento.module.css';
import { DocumentoAccordion } from './DocumentoAccordion';
import { DocumentoCitasSection } from './DocumentoCitasSection';
import { DocumentoDownloadSection } from './DocumentoDownloadSection';
import { DocumentoMasInfoSection } from './DocumentoMasInfoSection';
import { DocumentoReferenciasSection } from './DocumentoReferenciasSection';
import { DocumentoResenaSection } from './DocumentoResenaSection';
import { DocumentoShareSection } from './DocumentoShareSection';
import { DocumentoSumariosSection } from './DocumentoSumariosSection';
import type { PdfViewerControls } from './PdfViewer';
import type { FichaSentencia, Sentencia } from '@/types/sentencia';

type Props = {
  data: FichaSentencia;
  publicView?: boolean;
  fichaHref: string;
  currentUrl: string;
  publicUrl?: string | null;
  pdfControls: PdfViewerControls;
  highlightQuery?: string;
  onGoToPage?: (page: number) => void;
};

function splitMagistrados(value?: string | null) {
  return (value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function DocumentoSidePanel({
  data,
  publicView = false,
  fichaHref,
  currentUrl,
  publicUrl,
  pdfControls,
  highlightQuery,
  onGoToPage,
}: Props) {
  const sentencia = data.sentencia as Partial<Sentencia>;
  const magistrados = splitMagistrados(sentencia.magistrados);

  return (
    <>
      {highlightQuery ? (
        <div className={styles.searchNotice}>
          Resaltando coincidencias para: <strong>{highlightQuery}</strong>
        </div>
      ) : null}

      <DocumentoAccordion title="Sumarios" defaultOpen>
        <DocumentoSumariosSection
          sumarios={data.sumarios}
          highlightQuery={highlightQuery}
          onGoToPage={onGoToPage}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Reseña" defaultOpen>
        <DocumentoResenaSection
          resena={data.resena}
          publicada={sentencia.resenaPublicada}
          updatedAt={sentencia.resenaUpdatedAt}
          publicView={publicView}
          highlightQuery={highlightQuery}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Referencias normativas">
        <DocumentoReferenciasSection
          normativas={data.referenciasNormativas}
          highlightQuery={highlightQuery}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Referencias jurisprudenciales">
        <DocumentoReferenciasSection
          jurisprudenciales={data.referenciasJurisprudenciales}
          highlightQuery={highlightQuery}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Referencias doctrinarias">
        <DocumentoReferenciasSection
          doctrinarias={data.referenciasDoctrinarias}
          highlightQuery={highlightQuery}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Citas del fallo" defaultOpen>
        <DocumentoCitasSection
          citas={data.citasFallo ?? []}
          publicView={publicView}
          onGoToPage={onGoToPage}
        />
      </DocumentoAccordion>

      <DocumentoAccordion title="Más información">
        {magistrados.length > 0 ? (
          <div className={styles.section}>
            <strong>Votos / Magistrados</strong>
            <div className={styles.list}>
              {magistrados.map((item) => (
                <div key={item} className={styles.item}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <DocumentoMasInfoSection sentencia={sentencia} />
      </DocumentoAccordion>

      <DocumentoAccordion title="Descargar / imprimir / compartir" defaultOpen>
        <DocumentoDownloadSection pdfControls={pdfControls} fichaHref={fichaHref} />
        <DocumentoShareSection
          sentenciaId={sentencia.id ?? 0}
          currentUrl={currentUrl}
          publicUrl={publicUrl}
          cita={data.cita}
        />
      </DocumentoAccordion>
    </>
  );
}
