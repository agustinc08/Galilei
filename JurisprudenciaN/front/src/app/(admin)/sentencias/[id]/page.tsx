'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArchivosPanel } from '@/components/archivos/ArchivosPanel';
import { AnonimizacionPanel } from '@/components/sentencias/AnonimizacionPanel';
import { BatchSumariosForm } from '@/components/sentencias/BatchSumariosForm';
import { CitasFalloPanel } from '@/components/sentencias/CitasFalloPanel';
import { ReferenciasDoctrinariasPanel } from '@/components/sentencias/ReferenciasDoctrinariasPanel';
import { ReferenciasJurisprudencialesPanel } from '@/components/sentencias/ReferenciasJurisprudencialesPanel';
import { ReferenciasNormativasPanel } from '@/components/sentencias/ReferenciasNormativasPanel';
import { ResenaEditor } from '@/components/sentencias/ResenaEditor';
import { SentenciaForm } from '@/components/sentencias/SentenciaForm';
import { SentenciaTimeline } from '@/components/sentencias/SentenciaTimeline';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton } from '@/components/ui/PrintButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { ShareLinkButton } from '@/components/ui/ShareLinkButton';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import { trackEvento } from '@/lib/tracking';
import { cn, formatDate, toDateInput } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import type { ApiResponse } from '@/types/common';
import type { Favorito } from '@/types/favorito';
import type { AccionLog } from '@/types/logs';
import type {
  CitaFallo,
  CitaSentencia,
  ResumenSentencia,
  SentenciaCompleta,
  SentenciaFormValues,
} from '@/types/sentencia';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api').replace(/\/api$/, '');

type FalloSimilar = {
  id: number;
  numeroSentencia: string | null;
  caratula: string | null;
  sala: string | null;
  fecha: string | null;
  temaPrincipal: string | null;
  scoreSimilitud: number;
  sumarioBreve: string | null;
};

export default function SentenciaDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { user } = useAuth();
  const { salas, tiposFallo, tribunalesOrigen } = useCatalogos();
  const [sentencia, setSentencia] = useState<SentenciaCompleta | null>(null);
  const [cita, setCita] = useState<CitaSentencia | null>(null);
  const [resumen, setResumen] = useState<ResumenSentencia>({
    resumenIa: '',
    resumenFuente: 'manual',
    resumenPublicado: false,
  });
  const [resena, setResena] = useState('');
  const [resenaAi, setResenaAi] = useState<string | null>(null);
  const [resenaPublicada, setResenaPublicada] = useState(false);
  const [resenaUpdatedAt, setResenaUpdatedAt] = useState<string | null>(null);
  const [resenaPublicadaAt, setResenaPublicadaAt] = useState<string | null>(null);
  const [citas, setCitas] = useState<CitaFallo[]>([]);
  const [timeline, setTimeline] = useState<AccionLog[]>([]);
  const [similares, setSimilares] = useState<FalloSimilar[]>([]);
  const [isSavingCitas, setIsSavingCitas] = useState(false);
  const [manualCita, setManualCita] = useState({
    tipo: '',
    referencia: '',
    contexto: '',
    pagina: '',
  });
  const [isFavorita, setIsFavorita] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [possibleDuplicates, setPossibleDuplicates] = useState<Array<{ id: number; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingResumen, setIsSavingResumen] = useState(false);
  const [isSavingResena, setIsSavingResena] = useState(false);
  const [isGeneratingResenaAi, setIsGeneratingResenaAi] = useState(false);
  const [isSavingReferencias, setIsSavingReferencias] = useState(false);
  const [isDetectingNormas, setIsDetectingNormas] = useState(false);
  const [isSavingAnonimizacion, setIsSavingAnonimizacion] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (active) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const [sentenciaResponse, favoritosResponse, timelineResponse, similaresResponse] = await Promise.all([
          api.get<ApiResponse<SentenciaCompleta>>(`/sentencias/${id}/completa`),
          api.get<ApiResponse<Favorito[]>>('/favoritos'),
          api.get<ApiResponse<AccionLog[]>>(`/sentencias/${id}/timeline`),
          api.get<ApiResponse<FalloSimilar[]>>(`/sentencias/${id}/similares`, {
            query: { limit: 5 },
          }),
        ]);

        if (!active) return;

        const data = sentenciaResponse.data;
        setSentencia(data);
        setCita(data.cita ?? null);
        setResumen({
          resumenIa: data.resumenIa ?? '',
          resumenFuente: data.resumenFuente ?? 'manual',
          resumenPublicado: data.resumenPublicado ?? false,
        });
        setResena(data.resena ?? '');
        setResenaAi(data.resenaAi ?? null);
        setResenaPublicada(data.resenaPublicada ?? false);
        setResenaUpdatedAt(data.resenaUpdatedAt ?? null);
        setResenaPublicadaAt(data.resenaPublicadaAt ?? null);
        setCitas(data.citasFallo ?? []);
        setTimeline(timelineResponse.data);
        setSimilares(similaresResponse.data);
        setIsFavorita(favoritosResponse.data.some((favorito) => favorito.sentenciaId === data.id));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la sentencia.');
          setSentencia(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  const initialValues = useMemo<SentenciaFormValues>(
    () => ({
      numeroSentencia: sentencia?.numeroSentencia ?? '',
      tipoFallo: sentencia?.tipoFallo ?? '',
      tipoFalloId: sentencia?.tipoFalloId ?? '',
      sala: sentencia?.sala ?? '',
      salaId: sentencia?.salaId ?? '',
      fecha: toDateInput(sentencia?.fecha),
      expediente: sentencia?.expediente ?? '',
      tribunalOrigen: sentencia?.tribunalOrigen ?? '',
      tribunalOrigenId: sentencia?.tribunalOrigenId ?? '',
      caratula: sentencia?.caratula ?? '',
      actor: sentencia?.actor ?? '',
      demandado: sentencia?.demandado ?? '',
      objeto: sentencia?.objeto ?? '',
      magistrados: sentencia?.magistrados ?? '',
      juez: sentencia?.juez ?? '',
      observacionesInternas: sentencia?.observacionesInternas ?? '',
      estadoCarga: sentencia?.estadoCarga ?? 'BORRADOR',
      publicado: sentencia?.publicado ?? false,
      activo: sentencia?.activo ?? true,
    }),
    [sentencia],
  );

  const refreshSentencia = async () => {
    const [response, timelineResponse, similaresResponse] = await Promise.all([
      api.get<ApiResponse<SentenciaCompleta>>(`/sentencias/${id}/completa`),
      api.get<ApiResponse<AccionLog[]>>(`/sentencias/${id}/timeline`),
      api.get<ApiResponse<FalloSimilar[]>>(`/sentencias/${id}/similares`, {
        query: { limit: 5 },
      }),
    ]);
    setSentencia(response.data);
    setCita(response.data.cita ?? null);
    setResumen({
      resumenIa: response.data.resumenIa ?? '',
      resumenFuente: response.data.resumenFuente ?? 'manual',
      resumenPublicado: response.data.resumenPublicado ?? false,
    });
    setResena(response.data.resena ?? '');
    setResenaAi(response.data.resenaAi ?? null);
    setResenaPublicada(response.data.resenaPublicada ?? false);
    setResenaUpdatedAt(response.data.resenaUpdatedAt ?? null);
    setResenaPublicadaAt(response.data.resenaPublicadaAt ?? null);
    setCitas(response.data.citasFallo ?? []);
    setTimeline(timelineResponse.data);
    setSimilares(similaresResponse.data);
  };

  const updateSentencia = async (values: SentenciaFormValues) => {
    const { tipoFalloId, salaId, tribunalOrigenId, ...textValues } = values;
    await api.patch(`/sentencias/${id}`, {
      ...textValues,
      ...(typeof tipoFalloId === 'number' ? { tipoFalloId } : {}),
      ...(typeof salaId === 'number' ? { salaId } : {}),
      ...(typeof tribunalOrigenId === 'number' ? { tribunalOrigenId } : {}),
      fecha: values.fecha ? new Date(values.fecha).toISOString() : undefined,
    });
    setFeedback('Sentencia actualizada.');
    const duplicates = await api.get<{ data: typeof possibleDuplicates }>(`/sentencias/${id}/posibles-duplicados`);
    setPossibleDuplicates(duplicates.data);
    await refreshSentencia();
  };

  const saveResumen = async () => {
    setIsSavingResumen(true);
    try {
      await api.patch(`/sentencias/${id}/resumen`, resumen);
      setFeedback('Resumen actualizado.');
      await refreshSentencia();
    } finally {
      setIsSavingResumen(false);
    }
  };

  const saveResena = async () => {
    setIsSavingResena(true);
    try {
      await api.patch(`/sentencias/${id}/resena`, { resena });
      setFeedback('Reseña actualizada.');
      await refreshSentencia();
    } finally {
      setIsSavingResena(false);
    }
  };

  const generarResenaAi = async () => {
    setIsGeneratingResenaAi(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await api.post<
        ApiResponse<{
          resenaIa: string;
          resenaAi?: string;
          resena?: string;
          similares: FalloSimilar[];
          advertencias?: string[];
          documentos: unknown[];
          message?: string;
        }>
      >(`/sentencias/${id}/resena/generar-ia`);
      const sugerida = response.data.resenaIa || response.data.resenaAi || response.data.resena || '';
      setResenaAi(sugerida || null);
      setSimilares(response.data.similares ?? []);
      if (sugerida && !resena.trim()) {
        setResena(sugerida);
      }
      setFeedback(
        response.data.message ??
          `Borrador de reseña generada con ${response.data.documentos.length} documentos de referencia.`,
      );
    } catch {
      setError('No se pudo conectar con Ollama. Verificá que esté corriendo en http://localhost:11434.');
    } finally {
      setIsGeneratingResenaAi(false);
    }
  };

  const toggleResenaPublicacion = async () => {
    await api.patch(
      `/sentencias/${id}/resena/${resenaPublicada ? 'despublicar' : 'publicar'}`,
    );
    setFeedback(
      resenaPublicada ? 'Reseña despublicada.' : 'Reseña publicada.',
    );
    await refreshSentencia();
  };

  const togglePublication = async () => {
    if (!sentencia) return;
    if (!sentencia.publicado && !window.confirm('¿Publicar este fallo? Será visible en la consulta pública.')) return;
    await api.patch(`/sentencias/${id}/${sentencia.publicado ? 'despublicar' : 'publicar'}`);
    setFeedback(sentencia.publicado ? 'Sentencia despublicada.' : 'Sentencia publicada.');
    await refreshSentencia();
  };

  const archiveSentence = async () => {
    if (!sentencia || !window.confirm('¿Archivar este fallo? Dejará de aparecer en la consulta pública y conservará su historial.')) return;
    await api.patch(`/sentencias/${id}/archivar`);
    setFeedback('Fallo archivado.');
    await refreshSentencia();
  };

  const toggleFavorito = async () => {
    if (isFavorita) {
      await api.delete(`/favoritos/${id}`);
      setFeedback('Sentencia quitada de favoritos.');
      setIsFavorita(false);
      return;
    }

    await api.post(`/favoritos/${id}`);
    setFeedback('Sentencia guardada en favoritos.');
    setIsFavorita(true);
  };

  const regenerateCita = async () => {
    const response = await api.post<ApiResponse<CitaSentencia>>(`/sentencias/${id}/generar-cita`);
    setCita(response.data);
    setFeedback('Cita regenerada.');
    await refreshSentencia();
  };

  const toggleDestacada = async () => {
    if (!sentencia) return;
    await api.patch(`/sentencias/${id}/${sentencia.destacada ? 'quitar-destacada' : 'destacar'}`);
    setFeedback(sentencia.destacada ? 'Sentencia quitada de destacadas.' : 'Sentencia marcada como destacada.');
    await refreshSentencia();
  };

  const generateSlug = async () => {
    const response = await api.post<ApiResponse<{ slugPublico: string }>>(`/sentencias/${id}/generar-slug`);
    setFeedback(`Enlace público generado: ${response.data.slugPublico}`);
    await refreshSentencia();
  };

  const detectarCitas = async () => {
    setIsSavingCitas(true);
    try {
      const response = await api.post<
        ApiResponse<{ encontradas: number; creadas: number; duplicadas: number; errores: number }>
      >(`/sentencias/${id}/citas/detectar`);
      setFeedback(
        `Deteccion finalizada. ${response.data.creadas} creadas, ${response.data.duplicadas} duplicadas, ${response.data.encontradas} encontradas.`,
      );
      await refreshSentencia();
    } finally {
      setIsSavingCitas(false);
    }
  };

  const guardarCitaManual = async () => {
    if (!manualCita.tipo.trim() || !manualCita.referencia.trim()) {
      setError('Tipo y referencia son obligatorios para la cita manual.');
      return;
    }

    setIsSavingCitas(true);
    try {
      await api.post(`/sentencias/${id}/citas`, {
        tipo: manualCita.tipo,
        referencia: manualCita.referencia,
        contexto: manualCita.contexto || undefined,
        pagina: manualCita.pagina ? Number(manualCita.pagina) : undefined,
        confirmada: true,
      });
      setManualCita({ tipo: '', referencia: '', contexto: '', pagina: '' });
      setFeedback('Cita manual agregada.');
      await refreshSentencia();
    } finally {
      setIsSavingCitas(false);
    }
  };

  const actualizarCita = async (citaId: number, payload: Partial<CitaFallo>) => {
    setIsSavingCitas(true);
    try {
      await api.patch(`/citas-fallo/${citaId}`, payload);
      setFeedback('Cita actualizada.');
      await refreshSentencia();
    } finally {
      setIsSavingCitas(false);
    }
  };

  const eliminarCita = async (citaId: number) => {
    setIsSavingCitas(true);
    try {
      await api.delete(`/citas-fallo/${citaId}`);
      setFeedback('Cita eliminada.');
      await refreshSentencia();
    } finally {
      setIsSavingCitas(false);
    }
  };

  const crearReferenciaNormativa = async (values: {
    normaArticuloId: string;
    tipoNorma: string;
    numeroNorma: string;
    articulo: string;
    inciso: string;
    textoReferencia: string;
    url: string;
  }) => {
    setIsSavingReferencias(true);
    try {
      await api.post(`/sentencias/${id}/referencias-normativas`, {
        normaArticuloId: values.normaArticuloId
          ? Number(values.normaArticuloId)
          : undefined,
        tipoNorma: values.tipoNorma,
        numeroNorma: values.numeroNorma || undefined,
        articulo: values.articulo || undefined,
        inciso: values.inciso || undefined,
        textoReferencia: values.textoReferencia || undefined,
        url: values.url || undefined,
      });
      setFeedback('Referencia normativa agregada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const eliminarReferenciaNormativa = async (referenciaId: number) => {
    setIsSavingReferencias(true);
    try {
      await api.delete(`/referencias-normativas/${referenciaId}`);
      setFeedback('Referencia normativa eliminada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const detectarNormas = async () => {
    setIsDetectingNormas(true);
    try {
      const response = await api.post<
        ApiResponse<{ detectadas: unknown[]; creadas: number; duplicadas: number }>
      >(`/sentencias/${id}/referencias-normativas/detectar`);
      setFeedback(
        `Detección normativa finalizada. ${response.data.creadas} creadas, ${response.data.duplicadas} duplicadas, ${response.data.detectadas.length} detectadas.`,
      );
      await refreshSentencia();
    } finally {
      setIsDetectingNormas(false);
    }
  };

  const crearReferenciaJurisprudencial = async (values: {
    referencia: string;
    textoOriginal: string;
    falloRelacionadoId: string;
  }) => {
    setIsSavingReferencias(true);
    try {
      await api.post(`/sentencias/${id}/referencias-jurisprudenciales`, {
        referencia: values.referencia,
        textoOriginal: values.textoOriginal || undefined,
        falloRelacionadoId: values.falloRelacionadoId
          ? Number(values.falloRelacionadoId)
          : undefined,
      });
      setFeedback('Referencia jurisprudencial agregada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const eliminarReferenciaJurisprudencial = async (referenciaId: number) => {
    setIsSavingReferencias(true);
    try {
      await api.delete(`/referencias-jurisprudenciales/${referenciaId}`);
      setFeedback('Referencia jurisprudencial eliminada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const crearReferenciaDoctrinaria = async (values: {
    autor: string;
    titulo: string;
    fuente: string;
    anio: string;
    textoReferencia: string;
    url: string;
  }) => {
    setIsSavingReferencias(true);
    try {
      await api.post(`/sentencias/${id}/referencias-doctrinarias`, {
        autor: values.autor || undefined,
        titulo: values.titulo || undefined,
        fuente: values.fuente || undefined,
        anio: values.anio ? Number(values.anio) : undefined,
        textoReferencia: values.textoReferencia || undefined,
        url: values.url || undefined,
      });
      setFeedback('Referencia doctrinaria agregada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const eliminarReferenciaDoctrinaria = async (referenciaId: number) => {
    setIsSavingReferencias(true);
    try {
      await api.delete(`/referencias-doctrinarias/${referenciaId}`);
      setFeedback('Referencia doctrinaria eliminada.');
      await refreshSentencia();
    } finally {
      setIsSavingReferencias(false);
    }
  };

  const anonimizarSentencia = async () => {
    setIsSavingAnonimizacion(true);
    try {
      await api.patch(`/sentencias/${id}/anonimizar`);
      setFeedback('Sentencia anonimizada para vista publica.');
      await refreshSentencia();
    } finally {
      setIsSavingAnonimizacion(false);
    }
  };

  const desanonimizarSentencia = async () => {
    setIsSavingAnonimizacion(true);
    try {
      await api.patch(`/sentencias/${id}/desanonimizar`);
      setFeedback('Sentencia desanonimizada.');
      await refreshSentencia();
    } finally {
      setIsSavingAnonimizacion(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner label="Cargando sentencia..." />;
  }

  if (!sentencia) {
    return <EmptyState title="Sentencia no encontrada" description={error ?? 'No se encontro la sentencia solicitada.'} />;
  }

  const internalLink = typeof window !== 'undefined' ? window.location.href : '';
  const publicLink = sentencia.slugPublico ? `${API_BASE}/api/public/sentencias/${sentencia.slugPublico}` : '';
  const isAdmin = user?.rol.nombre === 'ADMIN';

  return (
    <div className={styles.section}>
      <PageHeader
        title={sentencia.caratula || sentencia.numeroSentencia || `Fallo ${sentencia.id}`}
        description={[
          sentencia.expediente ? `Expte. ${sentencia.expediente}` : null,
          sentencia.numeroSentencia ? `Sentencia ${sentencia.numeroSentencia}` : null,
          sentencia.sala ? (sentencia.sala.toLowerCase().startsWith('sala') ? sentencia.sala : `Sala ${sentencia.sala}`) : 'Sin Sala informada',
          sentencia.fecha ? formatDate(sentencia.fecha) : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <div className={styles.inlineActions}>
            {sentencia.activo ? (
              <>
                <Button variant="secondary" onClick={() => void togglePublication()}>
                  {sentencia.publicado ? 'Retirar de consulta' : 'Publicar fallo'}
                </Button>
                <Button variant="secondary" onClick={() => void archiveSentence()}>Archivar</Button>
              </>
            ) : <span>Fallo archivado</span>}
            {sentencia.publicado && sentencia.slugPublico ? <Link href={`/fallos/${sentencia.slugPublico}`}><Button variant="secondary">Ver publicación</Button></Link> : null}
            <Link href="/sentencias"><Button variant="ghost">Volver a gestión</Button></Link>
            {isAdmin ? (
              <Button variant="secondary" onClick={() => void toggleDestacada()}>
                {sentencia.destacada ? 'Quitar destacada' : 'Marcar destacada'}
              </Button>
            ) : null}
          </div>
        }
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}
      {possibleDuplicates.length ? (
        <SectionCard title="Posibles fallos relacionados">
          <p>Encontramos decisiones que podrían corresponder al mismo expediente. Revisa antes de continuar; no se fusionaron automáticamente.</p>
          <ul>{possibleDuplicates.map((item) => <li key={item.id}><Link href={`/sentencias/${item.id}`}>{item.caratula || item.expediente || `Fallo ${item.id}`}</Link> · {item.sala || 'Sin Sala informada'} · {item.fecha ? formatDate(item.fecha) : 'Fecha no informada'}</li>)}</ul>
        </SectionCard>
      ) : null}

      <div className={styles.twoColumn}>
        <div className={styles.panelStack}>
          <SectionCard title="Datos de la sentencia">
            <SentenciaForm
              key={`sentencia-${sentencia.id}-${sentencia.updatedAt}`}
              initialValues={initialValues}
              submitLabel="Guardar cambios"
              onSubmit={updateSentencia}
              salas={salas}
              tiposFallo={tiposFallo}
              tribunalesOrigen={tribunalesOrigen}
            />
          </SectionCard>

          <SectionCard
            title="Resumen del fallo"
            actions={
              <Button onClick={() => void saveResumen()} disabled={isSavingResumen}>
                {isSavingResumen ? 'Guardando...' : 'Guardar resumen'}
              </Button>
            }
          >
            <Textarea
              label="Resumen"
              value={resumen.resumenIa ?? ''}
              onChange={(event) => setResumen((current) => ({ ...current, resumenIa: event.target.value }))}
            />
            <div className={styles.inlineActions}>
              <Button
                variant={resumen.resumenFuente === 'manual' ? 'primary' : 'secondary'}
                onClick={() => setResumen((current) => ({ ...current, resumenFuente: 'manual' }))}
              >
                Fuente manual
              </Button>
              <Button
                variant={resumen.resumenFuente === 'ia' ? 'primary' : 'secondary'}
                onClick={() => setResumen((current) => ({ ...current, resumenFuente: 'ia' }))}
              >
                Fuente IA
              </Button>
              <Button
                variant={resumen.resumenPublicado ? 'primary' : 'secondary'}
                onClick={() =>
                  setResumen((current) => ({
                    ...current,
                    resumenPublicado: !current.resumenPublicado,
                  }))
                }
              >
                {resumen.resumenPublicado ? 'Resumen publicado' : 'Publicar resumen'}
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="Reseña"
          >
            <ResenaEditor
              value={resena}
              sugeridaIa={resenaAi}
              isGeneratingIa={isGeneratingResenaAi}
              isSaving={isSavingResena}
              publicada={resenaPublicada}
              updatedAt={resenaUpdatedAt}
              publicadaAt={resenaPublicadaAt}
              onChange={setResena}
              onSave={() => void saveResena()}
              onTogglePublicacion={() => void toggleResenaPublicacion()}
              onGenerateIa={() => void generarResenaAi()}
            />
          </SectionCard>

          <SectionCard
            title="Este fallo cita a"
          >
            <CitasFalloPanel
              citas={citas}
              formValues={manualCita}
              isSaving={isSavingCitas}
              canDelete={isAdmin}
              onDetect={() => void detectarCitas()}
              onFormChange={setManualCita}
              onCreateManual={() => void guardarCitaManual()}
              onToggleConfirm={(citaItem) =>
                void actualizarCita(citaItem.id, {
                  confirmada: !citaItem.confirmada,
                })
              }
              onDelete={(citaId) => void eliminarCita(citaId)}
            />
          </SectionCard>

          <SectionCard title="Normas relacionadas">
            <ReferenciasNormativasPanel
              referencias={sentencia.referenciasNormativas ?? []}
              isSaving={isSavingReferencias}
              isDetecting={isDetectingNormas}
              onCreate={crearReferenciaNormativa}
              onDelete={eliminarReferenciaNormativa}
              onDetect={() => void detectarNormas()}
            />
          </SectionCard>

          <SectionCard title="Fallos similares">
            {similares.length === 0 ? (
              <EmptyState
                title="Sin fallos similares"
                description="Complete tema y sala para obtener fallos relacionados."
              />
            ) : (
              <div className={styles.listGrid}>
                {similares.map((similar) => (
                  <article key={similar.id} className={styles.listItem}>
                    <strong>
                      {similar.numeroSentencia ?? `Sentencia ${similar.id}`}
                      {similar.sala ? ` · Sala ${similar.sala}` : ''}
                    </strong>
                    <p>{similar.caratula ?? similar.temaPrincipal ?? 'Sin carátula'}</p>
                    {similar.sumarioBreve ? <p>{similar.sumarioBreve}</p> : null}
                    <div className={styles.badgeRow}>
                      <span className={styles.badge}>
                        {similar.scoreSimilitud > 0
                          ? `Similitud ${(similar.scoreSimilitud * 100).toFixed(0)}%`
                          : 'Coincidencia textual'}
                      </span>
                      {similar.fecha ? (
                        <span className={styles.badge}>{formatDate(similar.fecha)}</span>
                      ) : null}
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => window.open(`/sentencias/${similar.id}`, '_blank', 'noopener')}
                    >
                      Abrir
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Jurisprudencia relacionada">
            <ReferenciasJurisprudencialesPanel
              referencias={sentencia.referenciasJurisprudenciales ?? []}
              isSaving={isSavingReferencias}
              onCreate={crearReferenciaJurisprudencial}
              onDelete={eliminarReferenciaJurisprudencial}
            />
          </SectionCard>

          <SectionCard title="Doctrina">
            <ReferenciasDoctrinariasPanel
              referencias={sentencia.referenciasDoctrinarias ?? []}
              isSaving={isSavingReferencias}
              onCreate={crearReferenciaDoctrinaria}
              onDelete={eliminarReferenciaDoctrinaria}
            />
          </SectionCard>

          <SectionCard
            title="Cita"
            actions={
              <div className={styles.inlineActions}>
                <CopyButton value={cita?.citaCopiable ?? ''} label="Copiar cita" />
                <Button variant="secondary" onClick={() => void regenerateCita()}>
                  Regenerar cita
                </Button>
              </div>
            }
          >
            <div className={styles.codeBlock}>{cita?.citaBreve ?? 'Sin cita'}</div>
            <div className={styles.codeBlock}>{cita?.citaCompleta ?? 'Sin cita completa'}</div>
          </SectionCard>

          <SectionCard title="Sumarios">
            {sentencia.sumarios.length === 0 ? (
              <EmptyState title="No hay sumarios" description="Puedes cargarlos manualmente o por lote." />
            ) : (
              <div className={styles.listGrid}>
                {sentencia.sumarios.map((sumario) => (
                  <article key={sumario.id} className={styles.listItem}>
                    <strong>{sumario.numeroSumario ?? `Sumario ${sumario.id}`} · {sumario.tema ?? 'Sin tema'}</strong>
                    <p>{sumario.texto}</p>
                  </article>
                ))}
              </div>
            )}
            <BatchSumariosForm sentenciaId={id} onSubmitted={refreshSentencia} />
          </SectionCard>

          <SectionCard title="PDFs">
            <ArchivosPanel sentenciaId={id} allowDelete={Boolean(isAdmin)} />
          </SectionCard>

          <SectionCard title="Anonimizacion">
            <AnonimizacionPanel
              anonimizado={Boolean(sentencia.anonimizado)}
              actor={sentencia.actor}
              demandado={sentencia.demandado}
              actorPublico={sentencia.actorPublico}
              demandadoPublico={sentencia.demandadoPublico}
              isSaving={isSavingAnonimizacion}
              onAnonimizar={anonimizarSentencia}
              onDesanonimizar={desanonimizarSentencia}
            />
          </SectionCard>

          <SectionCard title="Historial">
            <SentenciaTimeline items={timeline} />
          </SectionCard>
        </div>

        <div className={cn(styles.panelStack, styles.stickyAside)}>
          <SectionCard title="Acciones">
            <div className={styles.inlineActions}>
              <FavoriteButton active={isFavorita} onToggle={() => void toggleFavorito()} />
              <Button
                variant="secondary"
                onClick={() => {
                  void trackEvento({
                    tipoEvento: 'view_documento',
                    sentenciaId: sentencia.id,
                    metadata: { origen: 'detalle-interno' },
                  });
                  window.open(`/sentencias/${id}/documento`, '_blank', 'noopener');
                }}
              >
                Ver documento
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.open(`/sentencias/${id}/imprimir`, '_blank', 'noopener')}
              >
                Ver ficha
              </Button>
              <PrintButton
                onPrint={() => {
                  void trackEvento({
                    tipoEvento: 'print_ficha',
                    sentenciaId: sentencia.id,
                    metadata: { origen: 'detalle-interno' },
                  });
                  window.open(`/sentencias/${id}/imprimir`, '_blank', 'noopener');
                }}
              />
              <ShareLinkButton url={internalLink} label="Copiar enlace interno" sentenciaId={sentencia.id} />
              {publicLink ? <ShareLinkButton url={publicLink} label="Copiar enlace público" sentenciaId={sentencia.id} /> : null}
            </div>
            <div className={styles.inlineActions}>
              {sentencia.publicado && !sentencia.slugPublico ? (
                <Button variant="secondary" onClick={() => void generateSlug()}>
                  Generar enlace público
                </Button>
              ) : null}
              {isAdmin ? (
                <Button variant="secondary" onClick={() => void toggleDestacada()}>
                  {sentencia.destacada ? 'Quitar destacada' : 'Marcar destacada'}
                </Button>
              ) : null}
            </div>
            <div className={styles.badgeRow}>
              <span className={`${styles.badge} ${sentencia.publicado ? styles.badgeSuccess : styles.badgeWarning}`}>{!sentencia.activo ? 'Archivado' : sentencia.publicado ? 'Publicado' : 'Borrador'}</span>
              {sentencia.destacada ? <span className={styles.badge}>Destacado</span> : null}
              {sentencia.resumenPublicado ? <span className={styles.badge}>Resumen visible</span> : null}
              {resenaPublicada ? <span className={styles.badge}>Reseña visible</span> : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
