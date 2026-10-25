'use client';

import { Link } from "@/lib/router-compat";
import { useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { ApiResponse, PaginatedResponse } from '@/types/common';
import type { CalidadDatos, ResumenGeneral, SentenciaEvento } from '@/types/estadisticas';
import type { Sentencia } from '@/types/sentencia';

const quickLinks = [
  { href: '/revision', title: 'Revisar pendientes', text: 'Resolver asociaciones y temas sugeridos con evidencia.' },
  { href: '/digesto', title: 'Explorar Digesto', text: 'Organizar documentos en colecciones temáticas.' },
  {
    href: '/sentencias/carga-rapida',
    title: 'Carga rápida',
    text: 'Alta simple de sentencia y sumario en una sola pantalla.',
  },
  {
    href: '/sentencias/nueva-completa',
    title: 'Nueva sentencia completa',
    text: 'Carga guiada con metadatos, PDF, sumarios, reseña, referencias y publicación.',
  },
  {
    href: '/busqueda-avanzada',
    title: 'Búsqueda avanzada',
    text: 'Consulta interna con filtros finos, guardado de búsquedas y exportación.',
  },
  {
    href: '/estadisticas',
    title: 'Estadísticas',
    text: 'Indicadores de contenido, uso público, calidad documental e informe anual.',
  },
  {
    href: '/consulta',
    title: 'Consulta pública',
    text: 'Abrir la consulta pública para buscar y ver fallos publicados.',
  },
];

type CorpusSummary = {
  physicalFiles: number; documents: number; pages: number; linked: number; unresolved: number;
  pendingAssociations: number; classifications: number; classificationCounts: Record<string, number>;
  statusCounts: Record<string, number>; selected: number; notSelected: number;
  digestoDocuments: number; digestoMemberships: number; sourceMissing: number;
  runs: Array<{ failed: number; ocrRequired: number }>;
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<ResumenGeneral | null>(null);
  const [ultimas, setUltimas] = useState<Sentencia[]>([]);
  const [masVistas, setMasVistas] = useState<SentenciaEvento[]>([]);
  const [calidad, setCalidad] = useState<CalidadDatos | null>(null);
  const [corpus, setCorpus] = useState<CorpusSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [
          resumenResponse,
          ultimasResponse,
          vistasResponse,
          calidadResponse,
          corpusResponse,
        ] = await Promise.all([
          api.get<ApiResponse<ResumenGeneral>>('/estadisticas/resumen-general'),
          api.get<PaginatedResponse<Sentencia>>('/sentencias', {
            query: { page: 1, pageSize: 4 },
          }),
          api.get<ApiResponse<SentenciaEvento[]>>('/estadisticas/uso/sentencias-mas-vistas'),
          api.get<ApiResponse<CalidadDatos>>('/estadisticas/calidad-datos'),
          api.get<CorpusSummary>('/corpus/documents/admin/summary'),
        ]);

        if (!active) return;

        setMetrics(resumenResponse.data);
        setUltimas(ultimasResponse.data);
        setMasVistas(vistasResponse.data);
        setCalidad(calidadResponse.data);
        setCorpus(corpusResponse);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : 'No se pudieron cargar las métricas.',
          );
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.section}>
      <PageHeader
        title="Panel institucional"
        description="Resumen general del sistema de carga, consulta y administración jurisprudencial."
      />

      {error ? (
        <StatusMessage variant="error" title="No se pudo cargar el dashboard" message={error} />
      ) : null}

      {!metrics ? (
        <LoadingSpinner label="Cargando métricas..." />
      ) : (
        <div className={styles.summaryGrid}>
          <div className={`${styles.metricCard} ${styles.metricPrimary}`}><span>Sentencias cargadas</span><strong>{metrics.totalSentencias}</strong></div>
          <div className={`${styles.metricCard} ${styles.metricInfo}`}><span>Sumarios cargados</span><strong>{metrics.totalSumarios}</strong></div>
          <div className={`${styles.metricCard} ${styles.metricSuccess}`}><span>PDFs disponibles</span><strong>{metrics.totalConPdf}</strong></div>
          <div className={`${styles.metricCard} ${styles.metricSuccess}`}><span>Fallos publicados</span><strong>{metrics.totalPublicadas}</strong></div>
          <div className={`${styles.metricCard} ${styles.metricDanger}`}><span>Fallos sin PDF</span><strong>{calidad?.sentenciasSinPdf ?? '-'}</strong></div>
          <div className={`${styles.metricCard} ${styles.metricWarning}`}><span>Fallos sin reseña</span><strong>{calidad?.sentenciasSinResena ?? '-'}</strong></div>
        </div>
      )}

      <div className={styles.quickLinks}>
        {quickLinks.map((item) => (
          <Link key={item.href} href={item.href} className={styles.quickLinkCard}>
            <strong>{item.title}</strong>
            <span className={styles.mutedText}>{item.text}</span>
          </Link>
        ))}
      </div>

      {corpus ? <Card>
        <div className={styles.splitHeader}><strong>Documentos del repositorio</strong><Link href="/corpus"><Button variant="secondary">Ver documentos</Button></Link></div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}><span>Archivos físicos</span><strong>{corpus.physicalFiles.toLocaleString('es-AR')}</strong></div>
          <div className={styles.summaryItem}><span>Documentos almacenados</span><strong>{corpus.documents.toLocaleString('es-AR')}</strong></div>
          <div className={styles.summaryItem}><span>Buscables</span><strong>{(corpus.statusCounts.INDEXED ?? 0).toLocaleString('es-AR')}</strong></div>
          <Link href="/revision?filter=ocr" className={styles.summaryItem}><span>OCR requerido · revisar</span><strong>{(corpus.statusCounts.OCR_REQUIRED ?? 0).toLocaleString('es-AR')}</strong></Link>
          <Link href="/digesto" className={styles.summaryItem}><span>Documentos Digesto</span><strong>{corpus.digestoDocuments.toLocaleString('es-AR')}</strong></Link>
          <div className={styles.summaryItem}><span>Vínculos a colecciones</span><strong>{corpus.digestoMemberships.toLocaleString('es-AR')}</strong></div>
          <Link href="/revision?filter=sourceMissing" className={styles.summaryItem}><span>Fuentes faltantes · revisar</span><strong>{corpus.sourceMissing.toLocaleString('es-AR')}</strong></Link>
          <div className={styles.summaryItem}><span>Asociaciones pendientes</span><strong>{corpus.pendingAssociations.toLocaleString('es-AR')}</strong></div>
          <Link href="/revision?filter=classification" className={styles.summaryItem}><span>Temas sugeridos pendientes</span><strong>{(corpus.classificationCounts.SUGGESTED ?? 0).toLocaleString('es-AR')}</strong></Link>
          <div className={styles.summaryItem}><span>Seleccionados</span><strong>{corpus.selected.toLocaleString('es-AR')}</strong></div>
          <div className={styles.summaryItem}><span>Errores de última corrida</span><strong>{corpus.runs[0]?.failed.toLocaleString('es-AR') ?? '0'}</strong></div>
        </div>
      </Card> : null}

      {calidad ? (
        <Card>
          <div className={styles.splitHeader}>
            <strong>Alertas de calidad documental</strong>
            <Link href="/estadisticas">
              <Button variant="secondary">Abrir estadísticas</Button>
            </Link>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}><span>Fallos sin resumen</span><strong>{calidad.sentenciasSinResumen}</strong></div>
            <div className={styles.summaryItem}><span>Fallos sin PDF</span><strong>{calidad.sentenciasSinPdf}</strong></div>
            <div className={styles.summaryItem}><span>Fallos sin sumarios</span><strong>{calidad.sentenciasSinSumarios}</strong></div>
            <div className={styles.summaryItem}><span>Sumarios sin tema</span><strong>{calidad.sumariosSinTema}</strong></div>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="Sin estadísticas disponibles"
          description="Cuando existan datos disponibles, este panel mostrará los indicadores del sistema."
        />
      )}

      {masVistas.length > 0 ? (
        <Card>
          <div className={styles.splitHeader}>
            <strong>Fallos más consultados</strong>
            <Link href="/estadisticas">
              <Button variant="secondary">Ver uso completo</Button>
            </Link>
          </div>
          <div className={styles.listGrid}>
            {masVistas.slice(0, 4).map((item) => (
              <article key={`${item.sentenciaId}-dashboard`} className={styles.listItem}>
                <strong>{item.sentencia?.caratula ?? item.sentencia?.numeroSentencia ?? `#${item.sentenciaId}`}</strong>
                <span className={styles.mutedText}>
                  {item.sentencia?.sala ?? 'Sin sala'} | {formatDate(item.sentencia?.fecha)}
                </span>
                <div className={styles.badgeRow}>
                  <span className={styles.badge}>{item.total} vistas</span>
                  {item.sentencia?.destacada ? <span className={styles.badge}>Destacada</span> : null}
                </div>
              </article>
            ))}
          </div>
        </Card>
      ) : null}

      {ultimas.length > 0 ? (
        <Card>
          <div className={styles.splitHeader}>
            <strong>Últimas sentencias cargadas</strong>
            <Link href="/sentencias">
              <Button variant="secondary">Ir al listado</Button>
            </Link>
          </div>
          <div className={styles.listGrid}>
            {ultimas.map((sentencia) => (
              <article key={`ultima-${sentencia.id}`} className={styles.listItem}>
                <strong>{sentencia.caratula ?? sentencia.numeroSentencia ?? `Sentencia #${sentencia.id}`}</strong>
                <span className={styles.mutedText}>
                  {sentencia.sala ?? 'Sin sala'} | {formatDate(sentencia.fecha)}
                </span>
                <div className={styles.badgeRow}>
                  {sentencia.tienePdf ? <span className={styles.badge}>PDF</span> : null}
                  {sentencia.resena ? <span className={styles.badge}>Con reseña</span> : null}
                  <span className={styles.badge}>{sentencia.publicado ? 'Publicada' : 'Interna'}</span>
                </div>
              </article>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
