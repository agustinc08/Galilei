'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';
import { useCatalogos } from '@/hooks/use-catalogos';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDate, toDateInput } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type { SentenciaCompleta } from '@/types/sentencia';
import type { Sumario } from '@/types/sumario';

type TabKey = 'sumarios' | 'busquedas';

type CargaRapidaSentenciaValues = {
  numeroSentencia: string;
  tipoFallo: string;
  tipoFalloId: number | '';
  sala: string;
  salaId: number | '';
  fecha: string;
  juez: string;
  tribunalOrigen: string;
  tribunalOrigenId: number | '';
  actor: string;
  demandado: string;
  objeto: string;
  magistrados: string;
  expediente: string;
  link: string;
};

type CargaRapidaSumarioValues = {
  id?: number;
  numeroSumario: string;
  tema: string;
  texto: string;
  publicado: boolean;
  activo: boolean;
};

const initialSentenciaValues: CargaRapidaSentenciaValues = {
  numeroSentencia: '',
  tipoFallo: '',
  tipoFalloId: '',
  sala: '',
  salaId: '',
  fecha: '',
  juez: '',
  tribunalOrigen: '',
  tribunalOrigenId: '',
  actor: '',
  demandado: '',
  objeto: '',
  magistrados: '',
  expediente: '',
  link: '',
};

const initialSumarioValues: CargaRapidaSumarioValues = {
  numeroSumario: '',
  tema: '',
  texto: '',
  publicado: false,
  activo: true,
};

function buildObservacionesLink(currentLink: string) {
  const value = currentLink.trim();
  return value ? `Link de apoyo: ${value}` : '';
}

export default function CargaRapidaPage() {
  const { user } = useAuth();
  const { salas, tiposFallo, tribunalesOrigen, isLoading: isLoadingCatalogos } = useCatalogos();
  const [tab, setTab] = useState<TabKey>('sumarios');
  const [searchNumero, setSearchNumero] = useState('');
  const [sentencia, setSentencia] = useState<CargaRapidaSentenciaValues>(initialSentenciaValues);
  const [sumario, setSumario] = useState<CargaRapidaSumarioValues>(initialSumarioValues);
  const [existingSentencia, setExistingSentencia] = useState<SentenciaCompleta | null>(null);
  const [sumarios, setSumarios] = useState<Sumario[]>([]);
  const [currentSumarioIndex, setCurrentSumarioIndex] = useState(-1);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedSumario = useMemo(
    () => (currentSumarioIndex >= 0 ? sumarios[currentSumarioIndex] ?? null : null),
    [currentSumarioIndex, sumarios],
  );

  const hydrateFromSentencia = (data: SentenciaCompleta) => {
    setExistingSentencia(data);
    setSentencia({
      numeroSentencia: data.numeroSentencia ?? '',
      tipoFallo: data.tipoFallo ?? '',
      tipoFalloId: data.tipoFalloId ?? '',
      sala: data.sala ?? '',
      salaId: data.salaId ?? '',
      fecha: toDateInput(data.fecha),
      juez: data.juez ?? '',
      tribunalOrigen: data.tribunalOrigen ?? '',
      tribunalOrigenId: data.tribunalOrigenId ?? '',
      actor: data.actor ?? '',
      demandado: data.demandado ?? '',
      objeto: data.objeto ?? '',
      magistrados: data.magistrados ?? '',
      expediente: data.expediente ?? '',
      link: '',
    });
    const activeSumarios = data.sumarios ?? [];
    setSumarios(activeSumarios);
    if (activeSumarios.length > 0) {
      setCurrentSumarioIndex(0);
      const first = activeSumarios[0];
      setSumario({
        id: first.id,
        numeroSumario: first.numeroSumario ?? '',
        tema: first.tema ?? '',
        texto: first.texto,
        publicado: first.publicado,
        activo: first.activo,
      });
    } else {
      setCurrentSumarioIndex(-1);
      setSumario(initialSumarioValues);
    }
  };

  const resetForNewSentencia = (numeroSentencia: string) => {
    setExistingSentencia(null);
    setSumarios([]);
    setCurrentSumarioIndex(-1);
    setSentencia({
      ...initialSentenciaValues,
      numeroSentencia,
    });
    setSumario(initialSumarioValues);
  };

  const buscarSentencia = async () => {
    const numero = searchNumero.trim();
    if (!numero) {
      setError('Ingresá un número de sentencia para buscar.');
      return;
    }

    setIsSearching(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await api.get<ApiResponse<SentenciaCompleta>>(
        `/sentencias/por-numero/${encodeURIComponent(numero)}`,
      );
      hydrateFromSentencia(response.data);
      setFeedback(`Se cargó la sentencia ${response.data.numeroSentencia ?? `#${response.data.id}`}.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No existe una sentencia')) {
        const shouldCreate = window.confirm(
          'No existe el registro buscado. ¿Confirma la creación del nuevo registro?',
        );
        if (shouldCreate) {
          resetForNewSentencia(numero);
          setFeedback('Puedes completar el formulario para crear la sentencia y su primer sumario.');
        }
      } else {
        setError(error instanceof Error ? error.message : 'No se pudo buscar la sentencia.');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const saveCargaRapida = async () => {
    if (!sentencia.numeroSentencia.trim()) {
      setError('La sentencia es obligatoria.');
      return;
    }
    if (!sentencia.sala.trim() && !sentencia.salaId) {
      setError('La sala es obligatoria.');
      return;
    }
    if (!sumario.texto.trim()) {
      setError('El texto del sumario es obligatorio.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const payload = {
        sentencia: {
          numeroSentencia: sentencia.numeroSentencia.trim(),
          tipoFallo: sentencia.tipoFallo || undefined,
          tipoFalloId: sentencia.tipoFalloId || undefined,
          sala: sentencia.sala || undefined,
          salaId: sentencia.salaId || undefined,
          fecha: sentencia.fecha ? new Date(sentencia.fecha).toISOString() : undefined,
          tribunalOrigen: sentencia.tribunalOrigen || undefined,
          tribunalOrigenId: sentencia.tribunalOrigenId || undefined,
          actor: sentencia.actor || undefined,
          demandado: sentencia.demandado || undefined,
          objeto: sentencia.objeto || undefined,
          juez: sentencia.juez || undefined,
          magistrados: sentencia.magistrados || undefined,
          expediente: sentencia.expediente || undefined,
          observacionesInternas: buildObservacionesLink(sentencia.link) || undefined,
        },
        sumario: {
          id: sumario.id,
          numeroSumario: sumario.numeroSumario || undefined,
          tema: sumario.tema || undefined,
          texto: sumario.texto,
          publicado: sumario.publicado,
          activo: sumario.activo,
        },
      };

      const response = await api.post<
        ApiResponse<{
          sentencia: SentenciaCompleta;
          sumario: Sumario;
          createdSentencia: boolean;
          updatedSumario: boolean;
        }>
      >('/sentencias/carga-rapida', payload);

      if (pdfFile) {
        const formData = new FormData();
        formData.append('file', pdfFile);
        await api.post(`/archivos/upload/sentencia/${response.data.sentencia.id}`, formData);
        setPdfFile(null);
      }

      const refreshed = await api.get<ApiResponse<SentenciaCompleta>>(
        `/sentencias/${response.data.sentencia.id}/completa`,
      );
      hydrateFromSentencia(refreshed.data);
      setSearchNumero(refreshed.data.numeroSentencia ?? '');
      const savedSumarioId = response.data.sumario.id;
      const nextIndex = refreshed.data.sumarios.findIndex((item) => item.id === savedSumarioId);
      setCurrentSumarioIndex(nextIndex);
      setFeedback(
        response.data.createdSentencia
          ? 'Se creo la sentencia y se guardo el sumario.'
          : response.data.updatedSumario
            ? 'Se actualizo el sumario de la sentencia.'
            : 'Se agrego un nuevo sumario a la sentencia.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar la carga rápida.');
    } finally {
      setIsSaving(false);
    }
  };

  const removeCurrentSumario = async () => {
    if (!sumario.id) {
      if (window.confirm('Se limpiara el sumario actual no guardado.')) {
        setSumario(initialSumarioValues);
      }
      return;
    }

    if (user?.rol.nombre !== 'ADMIN') {
      setError('Solo ADMIN puede eliminar sumarios existentes.');
      return;
    }

    if (!window.confirm('Se desactivara el sumario actual. ¿Desea continuar?')) {
      return;
    }

    try {
      await api.delete(`/sumarios/${sumario.id}`);
      if (existingSentencia) {
        const refreshed = await api.get<ApiResponse<SentenciaCompleta>>(
          `/sentencias/${existingSentencia.id}/completa`,
        );
        hydrateFromSentencia(refreshed.data);
      }
      setFeedback('Sumario desactivado.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo eliminar el sumario.');
    }
  };

  const goToSumario = (index: number) => {
    const target = sumarios[index];
    if (!target) return;
    setCurrentSumarioIndex(index);
    setSumario({
      id: target.id,
      numeroSumario: target.numeroSumario ?? '',
      tema: target.tema ?? '',
      texto: target.texto,
      publicado: target.publicado,
      activo: target.activo,
    });
  };

  const archivos = existingSentencia?.archivosPdf ?? [];
  const canNavigate = sumarios.length > 0 && selectedSumario;

  return (
    <div className={styles.section}>
      <PageHeader
        title="Carga rápida"
        description="Alta simple de sentencia y sumario, con catálogos y flujo corto para el equipo de Jurisprudencia."
        actions={
          <div className={styles.inlineActions}>
            <Link href="/sentencias/nueva-completa"><Button variant="secondary">Carga completa</Button></Link>
            <Link href="/busqueda-avanzada"><Button variant="secondary">Búsqueda avanzada</Button></Link>
          </div>
        }
      />

      {error ? <StatusMessage variant="error" title="No se pudo completar la operacion" message={error} /> : null}
      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}

      <Card>
        <div className={styles.inlineActions}>
          <Button variant={tab === 'sumarios' ? 'primary' : 'secondary'} onClick={() => setTab('sumarios')}>
            Sumarios
          </Button>
          <Button variant={tab === 'busquedas' ? 'primary' : 'secondary'} onClick={() => setTab('busquedas')}>
            Busquedas
          </Button>
        </div>
      </Card>

      {tab === 'busquedas' ? (
        <Card>
          <div className={styles.section}>
            <strong>Accesos de consulta</strong>
            <p>Use la carga rápida para altas simples. Para revisar o editar en profundidad, utilice el detalle de la sentencia.</p>
            <div className={styles.inlineActions}>
              <Link href="/sentencias"><Button variant="secondary">Listado de sentencias</Button></Link>
              <Link href="/sumarios"><Button variant="secondary">Listado de sumarios</Button></Link>
              <Link href="/busqueda-avanzada"><Button variant="secondary">Búsqueda avanzada</Button></Link>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'sumarios' ? (
        <>
          <Card>
            <div className={styles.inlineActions}>
              <Input
                label="Sentencia"
                value={searchNumero}
                onChange={(event) => setSearchNumero(event.target.value)}
              />
              <Button onClick={() => void buscarSentencia()} disabled={isSearching}>
                {isSearching ? 'Buscando...' : 'Buscar'}
              </Button>
            </div>
          </Card>

          {isLoadingCatalogos ? (
            <LoadingSpinner label="Cargando catálogos..." />
          ) : (
            <div className={styles.twoColumn}>
              <div className={styles.panelStack}>
                <Card>
                  <div className={styles.section}>
                    <strong>Datos de la sentencia</strong>
                    <div className={styles.formGrid}>
                      <Input label="Sentencia" value={sentencia.numeroSentencia} onChange={(event) => setSentencia((current) => ({ ...current, numeroSentencia: event.target.value }))} />
                      <Select
                        label="Tipo de fallo"
                        value={String(sentencia.tipoFalloId || '')}
                        options={[
                          { label: 'Seleccionar tipo', value: '' },
                          ...tiposFallo.map((item) => ({ label: item.nombre, value: String(item.id) })),
                        ]}
                        onChange={(event) => {
                          const selected = tiposFallo.find((item) => item.id === Number(event.target.value));
                          setSentencia((current) => ({
                            ...current,
                            tipoFalloId: event.target.value ? Number(event.target.value) : '',
                            tipoFallo: selected?.nombre ?? '',
                          }));
                        }}
                      />
                      <Select
                        label="Sala"
                        value={String(sentencia.salaId || '')}
                        options={[
                          { label: 'Seleccionar sala', value: '' },
                          ...salas.map((item) => ({ label: item.nombre, value: String(item.id) })),
                        ]}
                        onChange={(event) => {
                          const selected = salas.find((item) => item.id === Number(event.target.value));
                          setSentencia((current) => ({
                            ...current,
                            salaId: event.target.value ? Number(event.target.value) : '',
                            sala: selected?.nombre ?? '',
                          }));
                        }}
                      />
                      <Input label="Fecha" type="date" value={sentencia.fecha} onChange={(event) => setSentencia((current) => ({ ...current, fecha: event.target.value }))} />
                      <Input label="Juez" value={sentencia.juez} onChange={(event) => setSentencia((current) => ({ ...current, juez: event.target.value }))} />
                      <Select
                        label="Tribunal de origen"
                        value={String(sentencia.tribunalOrigenId || '')}
                        options={[
                          { label: 'Seleccionar tribunal', value: '' },
                          ...tribunalesOrigen.map((item) => ({ label: item.nombre, value: String(item.id) })),
                        ]}
                        onChange={(event) => {
                          const selected = tribunalesOrigen.find((item) => item.id === Number(event.target.value));
                          setSentencia((current) => ({
                            ...current,
                            tribunalOrigenId: event.target.value ? Number(event.target.value) : '',
                            tribunalOrigen: selected?.nombre ?? '',
                          }));
                        }}
                      />
                      <Input label="Actor" value={sentencia.actor} onChange={(event) => setSentencia((current) => ({ ...current, actor: event.target.value }))} />
                      <Input label="Demandado" value={sentencia.demandado} onChange={(event) => setSentencia((current) => ({ ...current, demandado: event.target.value }))} />
                      <Input label="Objeto" value={sentencia.objeto} onChange={(event) => setSentencia((current) => ({ ...current, objeto: event.target.value }))} />
                      <Input label="Magistrados" value={sentencia.magistrados} onChange={(event) => setSentencia((current) => ({ ...current, magistrados: event.target.value }))} />
                      <Input label="N° de expediente" value={sentencia.expediente} onChange={(event) => setSentencia((current) => ({ ...current, expediente: event.target.value }))} />
                      <Input label="Link" value={sentencia.link} onChange={(event) => setSentencia((current) => ({ ...current, link: event.target.value }))} />
                    </div>
                    <div className={styles.inlineActions}>
                      <label className={styles.quickLinkCard}>
                        <strong>Fallo completo PDF</strong>
                        <span className={styles.mutedText}>
                          {pdfFile ? pdfFile.name : archivos[0]?.nombreOriginal ?? 'Sin archivo seleccionado'}
                        </span>
                        <input
                          type="file"
                          accept="application/pdf"
                          hidden
                          onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className={styles.section}>
                    <strong>Sumario</strong>
                    <div className={styles.formGrid}>
                      <Input label="N° sumario" value={sumario.numeroSumario} onChange={(event) => setSumario((current) => ({ ...current, numeroSumario: event.target.value }))} />
                      <Input label="Tema" value={sumario.tema} onChange={(event) => setSumario((current) => ({ ...current, tema: event.target.value }))} />
                    </div>
                    <Textarea
                      label="Texto sumario"
                      value={sumario.texto}
                      onChange={(event) => setSumario((current) => ({ ...current, texto: event.target.value }))}
                    />
                    <div className={styles.checkboxGrid}>
                      <Checkbox
                        label="Publicado"
                        checked={sumario.publicado}
                        onChange={(event) => setSumario((current) => ({ ...current, publicado: event.target.checked }))}
                      />
                      <Checkbox
                        label="Activo"
                        checked={sumario.activo}
                        onChange={(event) => setSumario((current) => ({ ...current, activo: event.target.checked }))}
                      />
                    </div>
                    <div className={styles.inlineActions}>
                      <Button onClick={() => void saveCargaRapida()} disabled={isSaving}>
                        {isSaving ? 'Grabando...' : 'Grabar'}
                      </Button>
                      <Button variant="danger" onClick={() => void removeCurrentSumario()}>
                        Eliminar
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setCurrentSumarioIndex(-1);
                          setSumario(initialSumarioValues);
                        }}
                      >
                        Nueva
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => goToSumario(Math.max(currentSumarioIndex - 1, 0))}
                        disabled={!canNavigate || currentSumarioIndex <= 0}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => goToSumario(Math.min(currentSumarioIndex + 1, sumarios.length - 1))}
                        disabled={!canNavigate || currentSumarioIndex >= sumarios.length - 1}
                      >
                        Siguiente
                      </Button>
                    </div>
                    <p className={styles.mutedText}>
                      Operador: {user?.nombre} {user?.apellido ?? ''}. Puede guardar sin PDF y sin publicar.
                    </p>
                  </div>
                </Card>
              </div>

              <div className={styles.panelStack}>
                <Card>
                  <div className={styles.section}>
                    <strong>Contexto actual</strong>
                    {!existingSentencia ? (
                      <EmptyState
                        title="Sin sentencia cargada"
                        description="Busque un número de sentencia o confirme la creación de un nuevo registro."
                      />
                    ) : (
                      <>
                        <p>
                          <strong>Sentencia:</strong> {existingSentencia.numeroSentencia ?? `#${existingSentencia.id}`}
                        </p>
                        <p>
                          <strong>Sala:</strong> {existingSentencia.sala ?? '-'} | <strong>Fecha:</strong> {formatDate(existingSentencia.fecha)}
                        </p>
                        <p>
                          <strong>Expediente:</strong> {existingSentencia.expediente ?? '-'}
                        </p>
                        <p>
                          <strong>Estado:</strong> {existingSentencia.publicado ? 'Publicada' : 'Interna'} | {existingSentencia.estadoCarga ?? 'BORRADOR'}
                        </p>
                        <Link href={`/sentencias/${existingSentencia.id}`}>
                          <Button variant="secondary">Abrir detalle completo</Button>
                        </Link>
                      </>
                    )}
                  </div>
                </Card>

                <Card>
                  <div className={styles.section}>
                    <strong>Sumarios existentes</strong>
                    {sumarios.length === 0 ? (
                      <EmptyState title="Sin sumarios" description="La sentencia aun no tiene sumarios cargados." />
                    ) : (
                      <div className={styles.listGrid}>
                        {sumarios.map((item, index) => (
                          <article key={item.id} className={styles.listItem}>
                            <strong>{item.numeroSumario ?? `Sumario #${item.id}`}</strong>
                            <span className={styles.mutedText}>{item.tema ?? 'Sin tema'}</span>
                            <p>{item.texto.slice(0, 180)}...</p>
                            <Button variant="secondary" onClick={() => goToSumario(index)}>
                              Editar en carga rápida
                            </Button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
