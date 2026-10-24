'use client';

import { useMemo, useState } from 'react';
import { useRouter } from '@/lib/router-compat';
import styles from './wizard.module.css';
import { DatosBasicosStep } from './DatosBasicosStep';
import { PdfStep } from './PdfStep';
import { PublicacionStep } from './PublicacionStep';
import { ReferenciasStep } from './ReferenciasStep';
import { ResenaStep } from './ResenaStep';
import { SumariosStep } from './SumariosStep';
import { VistaPreviaStep } from './VistaPreviaStep';
import { WizardStepIndicator } from './WizardStepIndicator';
import type {
  WizardDraftSnapshot,
  WizardPublicacionOptions,
  WizardReferenciaDoctrinariaItem,
  WizardReferenciaJurisprudencialItem,
  WizardReferenciaNormativaItem,
  WizardSumarioItem,
} from './wizard-types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import type { ArchivoPdf } from '@/types/archivo';
import type { ApiResponse } from '@/types/common';
import type { Sentencia, SentenciaCompleta, SentenciaFormValues } from '@/types/sentencia';

const steps = [
  'Datos basicos',
  'PDF',
  'Sumarios',
  'Reseña',
  'Referencias',
  'Publicación y anonimización',
  'Vista previa',
];

const initialSentencia: SentenciaFormValues = {
  numeroSentencia: '',
  tipoFallo: '',
  tipoFalloId: '',
  sala: '',
  salaId: '',
  fecha: '',
  expediente: '',
  tribunalOrigen: '',
  tribunalOrigenId: '',
  caratula: '',
  actor: '',
  demandado: '',
  objeto: '',
  magistrados: '',
  juez: '',
  observacionesInternas: '',
  estadoCarga: 'BORRADOR',
  publicado: false,
  activo: true,
};

const initialOpciones: WizardPublicacionOptions = {
  publicarSentencia: false,
  publicarSumarios: false,
  publicarResena: false,
  anonimizar: false,
  generarSlugPublico: false,
  destacada: false,
};

function buildInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ');
}

export function SentenciaWizard() {
  const router = useRouter();
  const { salas, tiposFallo, tribunalesOrigen } = useCatalogos();
  const [currentStep, setCurrentStep] = useState(0);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [sentencia, setSentencia] = useState<SentenciaFormValues>(initialSentencia);
  const [archivos, setArchivos] = useState<ArchivoPdf[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [sumarios, setSumarios] = useState<WizardSumarioItem[]>([]);
  const [resena, setResena] = useState('');
  const [referenciasNormativas, setReferenciasNormativas] = useState<WizardReferenciaNormativaItem[]>([]);
  const [referenciasJurisprudenciales, setReferenciasJurisprudenciales] = useState<WizardReferenciaJurisprudencialItem[]>([]);
  const [referenciasDoctrinarias, setReferenciasDoctrinarias] = useState<WizardReferenciaDoctrinariaItem[]>([]);
  const [opciones, setOpciones] = useState<WizardPublicacionOptions>(initialOpciones);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const snapshot = useMemo<WizardDraftSnapshot>(
    () => ({
      draftId,
      sentencia,
      pdfFile,
      archivos,
      sumarios,
      resena,
      referenciasNormativas,
      referenciasJurisprudenciales,
      referenciasDoctrinarias,
      opciones,
    }),
    [
      archivos,
      draftId,
      opciones,
      pdfFile,
      referenciasDoctrinarias,
      referenciasJurisprudenciales,
      referenciasNormativas,
      resena,
      sentencia,
      sumarios,
    ],
  );

  const updateSentencia = <K extends keyof SentenciaFormValues>(
    key: K,
    value: SentenciaFormValues[K],
  ) => {
    setSentencia((current) => ({ ...current, [key]: value }));
  };

  const updateOpciones = <K extends keyof WizardPublicacionOptions>(
    key: K,
    value: WizardPublicacionOptions[K],
  ) => {
    setOpciones((current) => ({ ...current, [key]: value }));
  };

  const validateDatosBasicos = () => {
    if (sentencia.fecha && Number.isNaN(new Date(sentencia.fecha).getTime())) {
      throw new Error('La fecha ingresada no es valida.');
    }
  };

  const persistDraft = async (estadoCarga: string) => {
    const payload = {
      ...sentencia,
      fecha: sentencia.fecha ? new Date(sentencia.fecha).toISOString() : undefined,
      estadoCarga,
      publicado: false,
    };

    if (draftId) {
      await api.patch(`/sentencias/${draftId}`, payload);
      return draftId;
    }

    const response = await api.post<ApiResponse<Sentencia>>('/sentencias', payload);
    setDraftId(response.data.id);
    return response.data.id;
  };

  const refreshDraft = async (id: number) => {
    const response = await api.get<ApiResponse<SentenciaCompleta>>(`/sentencias/${id}/completa`);
    setArchivos(response.data.archivosPdf ?? []);
  };

  const uploadPendingPdf = async (id: number) => {
    if (!pdfFile) {
      return;
    }

    const formData = new FormData();
    formData.append('file', pdfFile);
    try {
      await api.post(`/archivos/upload/sentencia/${id}`, formData);
    } catch (uploadError) {
      throw new Error(
        uploadError instanceof Error
          ? `No se pudo subir el PDF: ${uploadError.message}`
          : 'No se pudo subir el PDF. Verifica que el archivo sea PDF y vuelve a intentar.',
      );
    }
    setPdfFile(null);
    await refreshDraft(id);
  };

  const saveDraftOnly = async () => {
    setIsSaving(true);
    setError(null);
    setFeedback(null);

    try {
      validateDatosBasicos();
      const id = await persistDraft('BORRADOR');
      setFeedback(`Borrador guardado como sentencia #${id}. Puedes retomar luego desde su detalle.`);
      router.push(`/sentencias/${id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el borrador.');
    } finally {
      setIsSaving(false);
    }
  };

  const finalize = async (publishNow: boolean) => {
    setIsSaving(true);
    setError(null);
    setFeedback(null);

    try {
      validateDatosBasicos();
      const targetEstado = publishNow || opciones.publicarSentencia ? 'PUBLICADA' : 'COMPLETA';
      const id = await persistDraft(targetEstado);

      await uploadPendingPdf(id);

      if (sumarios.length > 0) {
        await api.post(`/sentencias/${id}/sumarios/lote`, {
          sumarios: sumarios.map((item) => ({
            numeroSumario: item.numeroSumario || undefined,
            tema: item.tema || undefined,
            texto: item.texto,
            publicado: publishNow || opciones.publicarSumarios ? true : item.publicado,
            activo: item.activo,
          })),
        });
        setSumarios([]);
      }

      if (resena.trim()) {
        await api.patch(`/sentencias/${id}/resena`, { resena });
        if (publishNow || opciones.publicarResena) {
          await api.patch(`/sentencias/${id}/resena/publicar`);
        }
      }

      for (const referencia of referenciasNormativas) {
        await api.post(`/sentencias/${id}/referencias-normativas`, {
          tipoNorma: referencia.tipoNorma,
          numeroNorma: referencia.numeroNorma || undefined,
          articulo: referencia.articulo || undefined,
          inciso: referencia.inciso || undefined,
          textoReferencia: referencia.textoReferencia || undefined,
          url: referencia.url || undefined,
        });
      }
      if (referenciasNormativas.length > 0) {
        setReferenciasNormativas([]);
      }

      for (const referencia of referenciasJurisprudenciales) {
        await api.post(`/sentencias/${id}/referencias-jurisprudenciales`, {
          referencia: referencia.referencia,
          falloRelacionadoId: referencia.falloRelacionadoId
            ? Number(referencia.falloRelacionadoId)
            : undefined,
          textoOriginal: referencia.textoOriginal || undefined,
        });
      }
      if (referenciasJurisprudenciales.length > 0) {
        setReferenciasJurisprudenciales([]);
      }

      for (const referencia of referenciasDoctrinarias) {
        await api.post(`/sentencias/${id}/referencias-doctrinarias`, {
          autor: referencia.autor || undefined,
          titulo: referencia.titulo || undefined,
          fuente: referencia.fuente || undefined,
          anio: referencia.anio ? Number(referencia.anio) : undefined,
          textoReferencia: referencia.textoReferencia || undefined,
          url: referencia.url || undefined,
        });
      }
      if (referenciasDoctrinarias.length > 0) {
        setReferenciasDoctrinarias([]);
      }

      await api.patch(`/sentencias/${id}`, {
        publicado: publishNow || opciones.publicarSentencia,
        destacada: opciones.destacada,
        estadoCarga: targetEstado,
        fecha: sentencia.fecha ? new Date(sentencia.fecha).toISOString() : undefined,
      });

      if (publishNow || opciones.publicarSentencia) {
        await api.patch(`/sentencias/${id}/publicar`);
      }

      if (opciones.destacada) {
        await api.patch(`/sentencias/${id}/destacar`);
      }

      if (opciones.anonimizar) {
        await api.patch(`/sentencias/${id}/anonimizar`);
      }

      if ((publishNow || opciones.publicarSentencia) && opciones.generarSlugPublico) {
        await api.post(`/sentencias/${id}/generar-slug`);
      }

      router.push(`/sentencias/${id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo finalizar la carga.');
    } finally {
      setIsSaving(false);
    }
  };

  const goNext = async () => {
    setError(null);

    try {
      if (currentStep === 0) {
        validateDatosBasicos();
        const id = await persistDraft('BORRADOR');
        await refreshDraft(id);
        setFeedback(`Borrador #${id} listo. Puedes continuar con el resto de la carga.`);
      }

      if (currentStep === 1) {
        const id = draftId ?? await persistDraft('BORRADOR');
        if (pdfFile) {
          await uploadPendingPdf(id);
          setFeedback('PDF asociado al borrador. Puedes continuar con los sumarios.');
        } else {
          setFeedback('Continúas sin PDF. Puedes cargarlo más adelante desde el detalle de la sentencia.');
        }
      }

      setCurrentStep((current) => Math.min(current + 1, steps.length - 1));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo avanzar al siguiente paso.');
    }
  };

  const actorPublicoPreview = sentencia.actor ? buildInitials(sentencia.actor) : '';
  const demandadoPublicoPreview = sentencia.demandado ? buildInitials(sentencia.demandado) : '';

  const stepContent = [
    <DatosBasicosStep
      key="datos"
      values={sentencia}
      salas={salas}
      tiposFallo={tiposFallo}
      tribunalesOrigen={tribunalesOrigen}
      onChange={updateSentencia}
    />,
    <PdfStep key="pdf" draftId={draftId} file={pdfFile} archivos={archivos} onFileChange={setPdfFile} />,
    <SumariosStep key="sumarios" items={sumarios} onChange={setSumarios} />,
    <ResenaStep
      key="resena"
      value={resena}
      publicar={opciones.publicarResena}
      onChange={setResena}
      onTogglePublicar={(value) => updateOpciones('publicarResena', value)}
    />,
    <ReferenciasStep
      key="referencias"
      normativas={referenciasNormativas}
      jurisprudenciales={referenciasJurisprudenciales}
      doctrinarias={referenciasDoctrinarias}
      onNormativasChange={setReferenciasNormativas}
      onJurisprudencialesChange={setReferenciasJurisprudenciales}
      onDoctrinariasChange={setReferenciasDoctrinarias}
    />,
    <PublicacionStep
      key="publicacion"
      actor={sentencia.actor}
      demandado={sentencia.demandado}
      opciones={opciones}
      actorPublicoPreview={actorPublicoPreview}
      demandadoPublicoPreview={demandadoPublicoPreview}
      onChange={updateOpciones}
    />,
    <VistaPreviaStep key="preview" snapshot={snapshot} />,
  ][currentStep];

  return (
    <div className={styles.wizard}>
      <WizardStepIndicator steps={steps} currentStep={currentStep} />

      {feedback ? (
        <StatusMessage variant="success" title="Proceso en curso" message={feedback} />
      ) : null}
      {error ? <StatusMessage variant="error" title="No se pudo continuar" message={error} /> : null}

      <Card>{stepContent}</Card>

      <div className={styles.stepActions}>
        <div className={styles.stepActionsGroup}>
          <Button
            variant="secondary"
            onClick={() => {
              if (window.confirm('Se perderán los cambios no guardados del formulario.')) {
                router.push('/sentencias');
              }
            }}
          >
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => void saveDraftOnly()} disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar borrador'}
          </Button>
        </div>

        <div className={styles.stepActionsGroup}>
          <Button
            variant="secondary"
            onClick={() => setCurrentStep((current) => Math.max(current - 1, 0))}
            disabled={currentStep === 0 || isSaving}
          >
            Anterior
          </Button>

          {currentStep < steps.length - 1 ? (
            <Button onClick={() => void goNext()} disabled={isSaving}>
              Siguiente
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void finalize(false)} disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Guardar borrador completo'}
              </Button>
              <Button onClick={() => void finalize(true)} disabled={isSaving}>
                {isSaving ? 'Publicando...' : 'Guardar y publicar'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
