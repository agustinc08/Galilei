'use client';

import Link from 'next/link';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyButton } from '@/components/ui/CopyButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table } from '@/components/ui/Table';
import { trackEvento } from '@/lib/tracking';
import { formatDate } from '@/lib/utils';
import type { BusquedaResultado } from '@/types/busqueda';

type Props = {
  data: BusquedaResultado[];
  internal?: boolean;
  query?: string;
};

export function BusquedaResultados({ data, internal = false, query }: Props) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="Sin resultados"
        description="Prueba cambiar el texto o relajar algunos filtros."
      />
    );
  }

  if (internal) {
    return (
      <Card>
        <Table>
          <thead>
            <tr>
              <th>Caratula</th>
              <th>Sala</th>
              <th>Fecha</th>
              <th>Resumen y highlights</th>
              <th>Relevancia</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.sentencia.id}>
                <td>{item.sentencia.caratula ?? item.sentencia.numeroSentencia ?? `#${item.sentencia.id}`}</td>
                <td>{item.sentencia.sala ?? '-'}</td>
                <td>{formatDate(item.sentencia.fecha)}</td>
                <td>
                  <div className={styles.section}>
                    <span>{item.resumenBreve ?? '-'}</span>
                    {item.highlights.length > 0 ? (
                      <div className={styles.listGrid}>
                        {item.highlights.slice(0, 2).map((highlight) => (
                          <div
                            key={`${item.sentencia.id}-${highlight.campo}-${highlight.texto}`}
                            className={styles.listItem}
                          >
                            <strong>{highlight.campo}</strong>
                            <span
                              className={styles.mutedText}
                              dangerouslySetInnerHTML={{ __html: highlight.texto }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className={styles.section}>
                    <strong>{item.score}</strong>
                    <span className={styles.mutedText}>
                      {item.matchInfo.exactPhraseMatches} frases exactas | {item.matchInfo.termMatches} terminos
                    </span>
                    {item.criterioPrincipal ? (
                      <span className={styles.mutedText}>
                        Criterio principal: {item.criterioPrincipal}
                      </span>
                    ) : null}
                    {item.matchedFields.length ? (
                      <span className={styles.mutedText}>
                        Campos: {item.matchedFields.join(', ')}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className={styles.inlineActions}>
                    <Link href={`/sentencias/${item.sentencia.id}`}>
                      <Button variant="secondary">Abrir</Button>
                    </Link>
                    <Link
                      href={`/sentencias/${item.sentencia.id}/documento${
                        query ? `?q=${encodeURIComponent(query)}` : ''
                      }`}
                      onClick={() =>
                        void trackEvento({
                          tipoEvento: 'view_documento',
                          sentenciaId: item.sentencia.id,
                          metadata: { origen: 'busqueda-avanzada' },
                        })
                      }
                    >
                      <Button variant="secondary">Ver documento</Button>
                    </Link>
                    <CopyButton
                      value={item.sentencia.caratula ?? item.sentencia.numeroSentencia ?? ''}
                      label="Copiar"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }

  return (
    <div className={styles.listGrid}>
      {data.map((item) => (
        <article key={item.sentencia.id} className={styles.listItem}>
          <strong>{item.sentencia.caratula ?? item.sentencia.numeroSentencia ?? `Sentencia #${item.sentencia.id}`}</strong>
          <span className={styles.mutedText}>
            {item.sentencia.sala ?? 'Sin sala'} | {formatDate(item.sentencia.fecha)}
          </span>
          <div className={styles.badgeRow}>
            {item.sumariosRelevantes[0]?.tema ? <span className={styles.badge}>{item.sumariosRelevantes[0].tema}</span> : null}
            {item.sentencia.pdfDisponible || item.sentencia.archivoPdfId ? <span className={styles.badge}>PDF</span> : null}
            {item.sentencia.destacada ? <span className={styles.badge}>Destacada</span> : null}
            {item.sentencia.resumenPublicado ? <span className={styles.badge}>Resumen</span> : null}
          </div>
          <p>{item.resumenBreve ?? 'Sin resumen disponible.'}</p>
          {item.highlights.length > 0 ? (
            <div className={styles.section}>
              {item.highlights.slice(0, 2).map((highlight) => (
                <div
                  key={`${item.sentencia.id}-${highlight.campo}-${highlight.texto}`}
                  className={styles.mutedText}
                  dangerouslySetInnerHTML={{ __html: highlight.texto }}
                />
              ))}
            </div>
          ) : null}
          <div className={styles.inlineActions}>
            {item.sentencia.slugPublico ? (
              <Link href={`/consulta/sentencia/${item.sentencia.slugPublico}`}>
                <Button variant="secondary">Ver detalle</Button>
              </Link>
            ) : null}
            {item.sentencia.slugPublico ? (
              <Link
                href={`/consulta/sentencia/${item.sentencia.slugPublico}/documento${
                  query ? `?q=${encodeURIComponent(query)}` : ''
                }`}
              >
                <Button variant="secondary">Ver documento</Button>
              </Link>
            ) : null}
            <CopyButton value={item.sentencia.caratula ?? item.sentencia.numeroSentencia ?? ''} label="Copiar cita" />
          </div>
        </article>
      ))}
    </div>
  );
}
