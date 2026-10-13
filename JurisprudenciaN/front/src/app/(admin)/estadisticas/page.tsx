'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { downloadBlob, formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type {
  CalidadDatos,
  EstadisticaAnual,
  EstadisticaConteo,
  InformeAnual,
  InformeAnualItem,
  InformeAnualMes,
  PublicacionStats,
  ResumenGeneral,
  SentenciaEvento,
  UsoResumen,
} from '@/types/estadisticas';

type SectionId =
  | 'resumen'
  | 'calidad'
  | 'anio'
  | 'mes'
  | 'sala'
  | 'tipo'
  | 'tribunal'
  | 'pdfs'
  | 'uso'
  | 'informe';

type PageState = Record<string, { page: number; pageSize: number }>;

const DEFAULT_PAGE = { page: 1, pageSize: 10 };

function PaginatedBlock<T>({
  id,
  items,
  pages,
  setPages,
  render,
}: {
  id: string;
  items: T[];
  pages: PageState;
  setPages: Dispatch<SetStateAction<PageState>>;
  render: (items: T[]) => ReactNode;
}) {
  const state = pages[id] ?? DEFAULT_PAGE;
  const pageCount = Math.max(1, Math.ceil(items.length / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const start = (page - 1) * state.pageSize;
  const visible = items.slice(start, start + state.pageSize);

  const update = (next: Partial<typeof DEFAULT_PAGE>) => {
    setPages((current) => ({
      ...current,
      [id]: { ...state, ...next },
    }));
  };

  return (
    <div className={styles.section}>
      {items.length === 0 ? (
        <p className={styles.mutedText}>No hay datos para este periodo.</p>
      ) : (
        render(visible)
      )}
      {items.length > state.pageSize || pageCount > 1 ? (
        <div className={styles.splitHeader}>
          <span className={styles.mutedText}>
            Página {page} de {pageCount}. Total: {items.length}
          </span>
          <div className={styles.inlineActions}>
            <Select
              label="Mostrar"
              value={String(state.pageSize)}
              onChange={(event) =>
                update({ page: 1, pageSize: Number(event.target.value) })
              }
              options={[
                { label: '10', value: '10' },
                { label: '25', value: '25' },
                { label: '50', value: '50' },
              ]}
            />
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => update({ page: page - 1 })}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={page >= pageCount}
              onClick={() => update({ page: page + 1 })}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccordionSection({
  id,
  title,
  isOpen,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.accordionItem}>
      <button
        className={styles.accordionHeader}
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <span>{isOpen ? 'Cerrar' : 'Abrir'}</span>
      </button>
      {isOpen ? <div className={styles.accordionBody}>{children}</div> : null}
    </div>
  );
}

export default function EstadisticasPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    resumen: true,
    calidad: false,
    anio: false,
    mes: false,
    sala: false,
    tipo: false,
    tribunal: false,
    pdfs: false,
    uso: false,
    informe: false,
  });
  const [pages, setPages] = useState<PageState>({});
  const [resumen, setResumen] = useState<ResumenGeneral | null>(null);
  const [porAnio, setPorAnio] = useState<EstadisticaAnual[]>([]);
  const [porMes, setPorMes] = useState<EstadisticaConteo[]>([]);
  const [porSala, setPorSala] = useState<EstadisticaConteo[]>([]);
  const [porTipo, setPorTipo] = useState<EstadisticaConteo[]>([]);
  const [porTema, setPorTema] = useState<EstadisticaConteo[]>([]);
  const [porTribunal, setPorTribunal] = useState<EstadisticaConteo[]>([]);
  const [calidad, setCalidad] = useState<CalidadDatos | null>(null);
  const [publicacion, setPublicacion] = useState<PublicacionStats | null>(null);
  const [usoBusquedas, setUsoBusquedas] = useState<EstadisticaConteo[]>([]);
  const [masVistas, setMasVistas] = useState<SentenciaEvento[]>([]);
  const [favoritos, setFavoritos] = useState<EstadisticaConteo[]>([]);
  const [compartidos, setCompartidos] = useState<EstadisticaConteo[]>([]);
  const [usoResumen, setUsoResumen] = useState<UsoResumen | null>(null);
  const [busquedasPopulares, setBusquedasPopulares] = useState<EstadisticaConteo[]>([]);
  const [busquedasSinResultados, setBusquedasSinResultados] = useState<EstadisticaConteo[]>([]);
  const [filtrosMasUsados, setFiltrosMasUsados] = useState<EstadisticaConteo[]>([]);
  const [sugerenciasClicks, setSugerenciasClicks] = useState<EstadisticaConteo[]>([]);
  const [documentosMasConsultados, setDocumentosMasConsultados] = useState<SentenciaEvento[]>([]);
  const [documentosMasDescargados, setDocumentosMasDescargados] = useState<SentenciaEvento[]>([]);
  const [actividadPorDia, setActividadPorDia] = useState<EstadisticaConteo[]>([]);
  const [annualYear, setAnnualYear] = useState(String(new Date().getFullYear()));
  const [annualReport, setAnnualReport] = useState<InformeAnual | null>(null);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [annualError, setAnnualError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [
          resumenResponse,
          porAnioResponse,
          porMesResponse,
          porSalaResponse,
          porTipoResponse,
          porTemaResponse,
          porTribunalResponse,
          calidadResponse,
          publicacionResponse,
          usoBusquedasResponse,
          masVistasResponse,
          favoritosResponse,
          compartidosResponse,
          usoResumenResponse,
          busquedasPopularesResponse,
          busquedasSinResultadosResponse,
          filtrosMasUsadosResponse,
          sugerenciasClicksResponse,
          documentosMasConsultadosResponse,
          documentosMasDescargadosResponse,
          actividadPorDiaResponse,
        ] = await Promise.all([
          api.get<ApiResponse<ResumenGeneral>>('/estadisticas/resumen-general'),
          api.get<ApiResponse<EstadisticaAnual[]>>('/estadisticas/por-anio'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/por-mes'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/por-sala'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/por-tipo-fallo'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/por-tema'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/por-tribunal-origen'),
          api.get<ApiResponse<CalidadDatos>>('/estadisticas/calidad-datos'),
          api.get<ApiResponse<PublicacionStats>>('/estadisticas/publicacion'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/busquedas'),
          api.get<ApiResponse<SentenciaEvento[]>>('/estadisticas/uso/sentencias-mas-vistas'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/favoritos'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/compartidos'),
          api.get<ApiResponse<UsoResumen>>('/estadisticas/uso/resumen'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/busquedas-populares'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/busquedas-sin-resultados'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/filtros-mas-usados'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/sugerencias-clicks'),
          api.get<ApiResponse<SentenciaEvento[]>>('/estadisticas/uso/documentos-mas-consultados'),
          api.get<ApiResponse<SentenciaEvento[]>>('/estadisticas/uso/documentos-mas-descargados'),
          api.get<ApiResponse<EstadisticaConteo[]>>('/estadisticas/uso/actividad-por-dia'),
        ]);

        if (!active) return;

        setResumen(resumenResponse.data);
        setPorAnio(porAnioResponse.data);
        setPorMes(porMesResponse.data);
        setPorSala(porSalaResponse.data);
        setPorTipo(porTipoResponse.data);
        setPorTema(porTemaResponse.data);
        setPorTribunal(porTribunalResponse.data);
        setCalidad(calidadResponse.data);
        setPublicacion(publicacionResponse.data);
        setUsoBusquedas(usoBusquedasResponse.data);
        setMasVistas(masVistasResponse.data);
        setFavoritos(favoritosResponse.data);
        setCompartidos(compartidosResponse.data);
        setUsoResumen(usoResumenResponse.data);
        setBusquedasPopulares(busquedasPopularesResponse.data);
        setBusquedasSinResultados(busquedasSinResultadosResponse.data);
        setFiltrosMasUsados(filtrosMasUsadosResponse.data);
        setSugerenciasClicks(sugerenciasClicksResponse.data);
        setDocumentosMasConsultados(documentosMasConsultadosResponse.data);
        setDocumentosMasDescargados(documentosMasDescargadosResponse.data);
        setActividadPorDia(actividadPorDiaResponse.data);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No se pudieron cargar las estadísticas.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const usoEventos = useMemo(
    () => [...usoBusquedas, ...favoritos, ...compartidos],
    [compartidos, favoritos, usoBusquedas],
  );

  const calidadItems = useMemo(
    () =>
      calidad
        ? [
            { nombre: 'Sin resumen', total: calidad.sentenciasSinResumen },
            { nombre: 'Sin reseña', total: calidad.sentenciasSinResena },
            { nombre: 'Sin PDF', total: calidad.sentenciasSinPdf },
            { nombre: 'Sin sumarios', total: calidad.sentenciasSinSumarios },
            { nombre: 'Sin actor', total: calidad.sentenciasSinActor },
            { nombre: 'Sin demandado', total: calidad.sentenciasSinDemandado },
            { nombre: 'Sin objeto', total: calidad.sentenciasSinObjeto },
            { nombre: 'Sumarios sin tema', total: calidad.sumariosSinTema },
          ]
        : [],
    [calidad],
  );

  const toggleSection = (id: SectionId) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const renderBar = (value: number, max: number) => (
    <div
      style={{
        width: `${max === 0 ? 0 : Math.max(10, (value / max) * 100)}%`,
        height: 8,
        background: '#2563eb',
        borderRadius: 999,
      }}
    />
  );

  const loadAnnualReport = async () => {
    setAnnualLoading(true);
    setAnnualError(null);
    try {
      const response = await api.get<ApiResponse<InformeAnual>>('/estadisticas/anual', {
        query: { anio: annualYear },
      });
      setAnnualReport(response.data);
    } catch (loadError) {
      setAnnualError(
        loadError instanceof Error
          ? loadError.message
          : 'No se pudo cargar el informe anual.',
      );
    } finally {
      setAnnualLoading(false);
    }
  };

  const downloadAnnualReport = async (formato: 'pdf' | 'docx') => {
    setAnnualError(null);
    try {
      const blob = await api.download('/estadisticas/anual/exportar', {
        query: { anio: annualYear, formato },
      });
      downloadBlob(blob, `informe-anual-${annualYear}.${formato}`);
    } catch (downloadError) {
      setAnnualError(
        downloadError instanceof Error
          ? downloadError.message
          : 'No se pudo descargar el informe anual.',
      );
    }
  };

  const renderAnnualTable = (
    id: string,
    title: string,
    items: Array<InformeAnualItem | InformeAnualMes>,
  ) => (
    <div className={styles.section}>
      <strong>{title}</strong>
      <PaginatedBlock
        id={id}
        items={items}
        pages={pages}
        setPages={setPages}
        render={(visible) => (
          <Table>
            <thead><tr><th>Concepto</th><th>Total</th></tr></thead>
            <tbody>
              {visible.map((item) => (
                <tr key={`${title}-${item.nombre}`}>
                  <td>{item.nombre}</td>
                  <td>{item.total}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      />
    </div>
  );

  return (
    <div className={styles.section}>
      <PageHeader
        title="Estadísticas"
        description="Contenido, calidad documental y uso del sistema."
        actions={
          <Link href="/dashboard">
            <Button variant="secondary">Volver</Button>
          </Link>
        }
      />

      {error ? (
        <StatusMessage
          variant="error"
          title="No se pudieron cargar las estadísticas"
          message={error}
        />
      ) : null}

      {loading || !resumen || !calidad || !publicacion ? (
        <LoadingSpinner label="Cargando estadísticas..." />
      ) : (
        <div className={styles.accordion}>
          <AccordionSection id="resumen" title="Resumen general" isOpen={openSections.resumen} onToggle={toggleSection}>
            <div className={styles.summaryGrid}>
              <Card><div className={styles.summaryItem}><span>Total sentencias</span><strong>{resumen.totalSentencias}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Total sumarios</span><strong>{resumen.totalSumarios}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Con PDF</span><strong>{resumen.totalConPdf}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Publicadas</span><strong>{resumen.totalPublicadas}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Destacadas</span><strong>{resumen.totalDestacadas}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Con resumen</span><strong>{resumen.totalConResumen}</strong></div></Card>
            </div>
          </AccordionSection>

          <AccordionSection id="calidad" title="Calidad de datos" isOpen={openSections.calidad} onToggle={toggleSection}>
            <PaginatedBlock
              id="calidad"
              items={calidadItems}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <div className={styles.listGrid}>
                  {visible.map((item) => (
                    <div className={styles.listItem} key={item.nombre}>
                      <strong>{item.nombre}</strong>
                      <span>{item.total}</span>
                    </div>
                  ))}
                </div>
              )}
            />
          </AccordionSection>

          <AccordionSection id="anio" title="Carga por año" isOpen={openSections.anio} onToggle={toggleSection}>
            <PaginatedBlock
              id="anio"
              items={porAnio}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <Table>
                  <thead><tr><th>Año</th><th>Sentencias</th><th>Sumarios</th></tr></thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.anio ?? 'sin-anio'}>
                        <td>{item.anio ?? '-'}</td>
                        <td>{item.sentencias}</td>
                        <td>{item.sumarios}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            />
          </AccordionSection>

          <AccordionSection id="mes" title="Carga por mes" isOpen={openSections.mes} onToggle={toggleSection}>
            <PaginatedBlock
              id="mes"
              items={porMes}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <Table>
                  <thead><tr><th>Mes</th><th>Total</th></tr></thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.mes ?? item.nombre}>
                        <td>{item.nombre ?? item.mes ?? '-'}</td>
                        <td>{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            />
          </AccordionSection>

          <AccordionSection id="sala" title="Distribución por sala" isOpen={openSections.sala} onToggle={toggleSection}>
            <PaginatedBlock
              id="sala"
              items={porSala}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <div className={styles.listGrid}>
                  {visible.map((item) => (
                    <div key={item.sala ?? 'sin-sala'} className={styles.listItem}>
                      <div className={styles.splitHeader}>
                        <span>{item.sala ?? 'Sin sala'}</span>
                        <strong>{item.total}</strong>
                      </div>
                      {renderBar(item.total, porSala[0]?.total ?? 0)}
                    </div>
                  ))}
                </div>
              )}
            />
          </AccordionSection>

          <AccordionSection id="tipo" title="Distribución por tipo de fallo" isOpen={openSections.tipo} onToggle={toggleSection}>
            <div className={styles.columns}>
              <PaginatedBlock
                id="tipo"
                items={porTipo}
                pages={pages}
                setPages={setPages}
                render={(visible) => (
                  <div className={styles.listGrid}>
                    {visible.map((item) => (
                      <div key={item.tipoFallo ?? 'sin-tipo'} className={styles.listItem}>
                        <div className={styles.splitHeader}>
                          <span>{item.tipoFallo ?? 'Sin tipo'}</span>
                          <strong>{item.total}</strong>
                        </div>
                        {renderBar(item.total, porTipo[0]?.total ?? 0)}
                      </div>
                    ))}
                  </div>
                )}
              />
              <PaginatedBlock
                id="temas"
                items={porTema}
                pages={pages}
                setPages={setPages}
                render={(visible) => (
                  <Table>
                    <thead><tr><th>Tema</th><th>Total</th></tr></thead>
                    <tbody>
                      {visible.map((item) => (
                        <tr key={item.tema ?? 'sin-tema'}>
                          <td>{item.tema ?? '-'}</td>
                          <td>{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              />
            </div>
          </AccordionSection>

          <AccordionSection id="tribunal" title="Tribunal de origen" isOpen={openSections.tribunal} onToggle={toggleSection}>
            <PaginatedBlock
              id="tribunal"
              items={porTribunal}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <Table>
                  <thead><tr><th>Tribunal</th><th>Total</th></tr></thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.tribunalOrigen ?? 'sin-tribunal'}>
                        <td>{item.tribunalOrigen ?? '-'}</td>
                        <td>{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            />
          </AccordionSection>

          <AccordionSection id="pdfs" title="PDF y documentación" isOpen={openSections.pdfs} onToggle={toggleSection}>
            <div className={styles.summaryGrid}>
              <Card><div className={styles.summaryItem}><span>Publicadas</span><strong>{publicacion.publicadas}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>No publicadas</span><strong>{publicacion.noPublicadas}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Destacadas</span><strong>{publicacion.destacadas}</strong></div></Card>
              <Card><div className={styles.summaryItem}><span>Resumen publicado</span><strong>{publicacion.conResumenPublicado}</strong></div></Card>
            </div>
            <PaginatedBlock
              id="pdf-descargas"
              items={documentosMasDescargados}
              pages={pages}
              setPages={setPages}
              render={(visible) => (
                <Table>
                  <thead><tr><th>Sentencia</th><th>Fecha</th><th>Descargas</th></tr></thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={`${item.sentenciaId}-downloads`}>
                        <td>{item.sentencia?.caratula ?? item.sentencia?.numeroSentencia ?? `#${item.sentenciaId}`}</td>
                        <td>{formatDate(item.sentencia?.fecha)}</td>
                        <td>{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            />
          </AccordionSection>

          <AccordionSection id="uso" title="Uso del sistema" isOpen={openSections.uso} onToggle={toggleSection}>
            {usoResumen ? (
              <div className={styles.summaryGrid}>
                <Card><div className={styles.summaryItem}><span>Búsquedas públicas</span><strong>{usoResumen.busquedasPublicas}</strong></div></Card>
                <Card><div className={styles.summaryItem}><span>Búsquedas internas</span><strong>{usoResumen.busquedasInternas}</strong></div></Card>
                <Card><div className={styles.summaryItem}><span>Sin resultados</span><strong>{usoResumen.busquedasSinResultados}</strong></div></Card>
                <Card><div className={styles.summaryItem}><span>Sugerencias clickeadas</span><strong>{usoResumen.sugerenciasClickeadas}</strong></div></Card>
                <Card><div className={styles.summaryItem}><span>Impresiones ficha</span><strong>{usoResumen.impresionesFicha}</strong></div></Card>
                <Card><div className={styles.summaryItem}><span>Exportaciones</span><strong>{usoResumen.exportaciones}</strong></div></Card>
              </div>
            ) : null}
            <div className={styles.columns}>
              <PaginatedBlock id="uso-eventos" items={usoEventos} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Evento</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.tipoEvento}><td>{item.tipoEvento}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="mas-vistas" items={masVistas} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Sentencia</th><th>Fecha</th><th>Vistas</th></tr></thead><tbody>{visible.map((item) => <tr key={`${item.sentenciaId}-views`}><td>{item.sentencia?.caratula ?? item.sentencia?.numeroSentencia ?? `#${item.sentenciaId}`}</td><td>{formatDate(item.sentencia?.fecha)}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="busquedas-populares" items={busquedasPopulares} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Término</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.termino ?? 'term'}><td>{item.termino ?? '-'}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="busquedas-sin-resultados" items={busquedasSinResultados} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Término</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.termino ?? 'sin-resultados'}><td>{item.termino ?? '-'}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="filtros" items={filtrosMasUsados} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Filtro</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.filtro ?? 'filtro'}><td>{item.filtro ?? '-'}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="sugerencias" items={sugerenciasClicks} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Sugerencia</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.termino ?? 'suggestion'}><td>{item.termino ?? '-'}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="documentos-consultados" items={documentosMasConsultados} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Sentencia</th><th>Fecha</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={`${item.sentenciaId}-doc`}><td>{item.sentencia?.caratula ?? item.sentencia?.numeroSentencia ?? `#${item.sentenciaId}`}</td><td>{formatDate(item.sentencia?.fecha)}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
              <PaginatedBlock id="actividad-dia" items={actividadPorDia} pages={pages} setPages={setPages} render={(visible) => (
                <Table><thead><tr><th>Fecha</th><th>Total</th></tr></thead><tbody>{visible.map((item) => <tr key={item.fecha ?? 'fecha'}><td>{item.fecha ?? '-'}</td><td>{item.total}</td></tr>)}</tbody></Table>
              )} />
            </div>
          </AccordionSection>

          <AccordionSection id="informe" title="Informe anual" isOpen={openSections.informe} onToggle={toggleSection}>
            <div className={styles.splitHeader}>
              <div>
                <strong>Informe anual</strong>
                <p className={styles.mutedText}>
                  Estadísticas de carga para la Secretaría de Documentación y Jurisprudencia.
                </p>
              </div>
              <div className={styles.inlineActions}>
                <Input
                  label="Año"
                  type="number"
                  value={annualYear}
                  onChange={(event) => setAnnualYear(event.target.value)}
                />
                <Button onClick={() => void loadAnnualReport()}>Ver estadísticas</Button>
                <Button variant="secondary" onClick={() => void downloadAnnualReport('pdf')}>Descargar PDF</Button>
                <Button variant="secondary" onClick={() => void downloadAnnualReport('docx')}>Descargar Word</Button>
              </div>
            </div>
            {annualError ? <StatusMessage variant="error" title="Informe anual" message={annualError} /> : null}
            {annualLoading ? <LoadingSpinner label="Cargando informe anual..." /> : null}
            {annualReport ? (
              <div className={styles.section}>
                <div className={styles.summaryGrid}>
                  <div className={`${styles.metricCard} ${styles.metricPrimary}`}><span>Sentencias cargadas</span><strong>{annualReport.porFechaCarga.totalSentenciasCargadas}</strong></div>
                  <div className={`${styles.metricCard} ${styles.metricInfo}`}><span>Sumarios cargados</span><strong>{annualReport.porFechaCarga.totalSumariosCargados}</strong></div>
                  <div className={`${styles.metricCard} ${styles.metricSuccess}`}><span>PDFs cargados</span><strong>{annualReport.porFechaCarga.totalPdfsCargados}</strong></div>
                  <div className={`${styles.metricCard} ${styles.metricWarning}`}><span>Sin reseña</span><strong>{annualReport.porFechaCarga.calidadDatos.sinResena}</strong></div>
                  <div className={`${styles.metricCard} ${styles.metricDanger}`}><span>Sin PDF</span><strong>{annualReport.porFechaCarga.calidadDatos.sinPdf}</strong></div>
                </div>
                <div className={styles.columns}>
                  {renderAnnualTable('annual-sala', 'Por sala', annualReport.porSala)}
                  {renderAnnualTable('annual-tipo', 'Por tipo de fallo', annualReport.porTipoFallo)}
                  {renderAnnualTable('annual-mes', 'Por mes', annualReport.porMes)}
                  {renderAnnualTable('annual-temas', 'Top temas', annualReport.topTemas)}
                </div>
                {renderAnnualTable('annual-tribunal', 'Por tribunal de origen', annualReport.porTribunalOrigen)}
              </div>
            ) : null}
          </AccordionSection>
        </div>
      )}
    </div>
  );
}
