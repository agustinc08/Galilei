'use client';

import { Button } from '@/components/ui/Button';
import { CopyReferenceButton } from '@/components/sentencias/CopyReferenceButton';
import styles from './documento.module.css';
import { DocumentoHighlight } from './DocumentoHighlight';
import type {
  ReferenciaDoctrinaria,
  ReferenciaJurisprudencial,
  ReferenciaNormativa,
} from '@/types/sentencia';

type Props = {
  normativas?: ReferenciaNormativa[];
  jurisprudenciales?: ReferenciaJurisprudencial[];
  doctrinarias?: ReferenciaDoctrinaria[];
  highlightQuery?: string;
};

export function DocumentoReferenciasSection({
  normativas,
  jurisprudenciales,
  doctrinarias,
  highlightQuery,
}: Props) {
  const showNormativas = normativas !== undefined;
  const showJurisprudenciales = jurisprudenciales !== undefined;
  const showDoctrinarias = doctrinarias !== undefined;
  const normativasItems = normativas ?? [];
  const jurisprudencialesItems = jurisprudenciales ?? [];
  const doctrinariasItems = doctrinarias ?? [];

  return (
    <div className={styles.section}>
      {showNormativas ? (
      <div>
        <strong>Normas relacionadas</strong>
        {normativasItems.length === 0 ? (
          <div className={styles.empty}>Sin referencias normativas cargadas.</div>
        ) : (
          <div className={styles.list}>
            {normativasItems.map((item) => {
              const referencia = `${item.tipoNorma}${item.numeroNorma ? ` ${item.numeroNorma}` : ''}${item.articulo ? ` art. ${item.articulo}` : ''}${item.inciso ? ` inc. ${item.inciso}` : ''}`;
              return (
                <article key={item.id} className={styles.item}>
                  <strong>
                    <DocumentoHighlight text={referencia} query={highlightQuery} />
                  </strong>
                  {item.textoReferencia ? (
                    <DocumentoHighlight
                      text={item.textoReferencia}
                      query={highlightQuery}
                      className={styles.context}
                    />
                  ) : null}
                  <div className={styles.actions}>
                    <CopyReferenceButton referencia={referencia} />
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        <Button variant="secondary">Abrir norma</Button>
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      ) : null}

      {showJurisprudenciales ? (
      <div>
        <strong>Jurisprudencia relacionada</strong>
        {jurisprudencialesItems.length === 0 ? (
          <div className={styles.empty}>Sin referencias jurisprudenciales cargadas.</div>
        ) : (
          <div className={styles.list}>
            {jurisprudencialesItems.map((item) => (
              <article key={item.id} className={styles.item}>
                <strong>
                  <DocumentoHighlight text={item.referencia} query={highlightQuery} />
                </strong>
                {item.textoOriginal ? (
                  <DocumentoHighlight
                    text={item.textoOriginal}
                    query={highlightQuery}
                    className={styles.context}
                  />
                ) : null}
                <div className={styles.actions}>
                  <CopyReferenceButton referencia={item.referencia} />
                  {item.falloRelacionado?.slugPublico ? (
                    <a
                      href={`/consulta/sentencia/${item.falloRelacionado.slugPublico}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="secondary">Abrir fallo vinculado</Button>
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      ) : null}

      {showDoctrinarias ? (
      <div>
        <strong>Doctrina</strong>
        {doctrinariasItems.length === 0 ? (
          <div className={styles.empty}>Sin referencias doctrinarias cargadas.</div>
        ) : (
          <div className={styles.list}>
            {doctrinariasItems.map((item) => {
              const referencia = [item.autor, item.titulo, item.fuente, item.anio]
                .filter(Boolean)
                .join(' - ');
              return (
                <article key={item.id} className={styles.item}>
                  <strong>
                    <DocumentoHighlight
                      text={referencia || 'Referencia doctrinaria'}
                      query={highlightQuery}
                    />
                  </strong>
                  <span className={styles.muted}>
                    {[item.fuente, item.anio].filter(Boolean).join(' | ')}
                  </span>
                  {item.textoReferencia ? (
                    <DocumentoHighlight
                      text={item.textoReferencia}
                      query={highlightQuery}
                      className={styles.context}
                    />
                  ) : null}
                  <div className={styles.actions}>
                    <CopyReferenceButton referencia={referencia} />
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        <Button variant="secondary">Abrir referencia</Button>
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      ) : null}
    </div>
  );
}
