"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedContent } from "@/components/layout/ProtectedContent";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { api } from "@/lib/api";
import styles from "./page.module.css";

type Summary = {
  id: string;
  status: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  duplicateDetected: boolean;
  extractionStatus: string | null;
  matchClassification: string | null;
  documentId: string | null;
  fileId: string | null;
  linkedSentenciaId: number | null;
  confirmedMetadata: Metadata | null;
  failureCode: string | null;
  failureMessageSafe: string | null;
  createdAt: string;
  updatedAt: string;
};
type Metadata = {
  expediente: string;
  sala: string;
  fecha: string;
  caratula: string;
  numeroSentencia?: string;
  tipoFallo?: string;
  tribunalOrigen?: string;
  magistrados?: string;
  observacionesInternas?: string;
};
type Candidate = {
  id: number;
  numeroSentencia: string | null;
  caratula: string | null;
  expediente: string | null;
  sala: string | null;
  fecha: string | null;
  publicado: boolean;
  estadoCarga: string;
};
type Detail = Summary & {
  document: { id: string; title: string; status: string; visibility: string; latestExtraction: { status: string; extractedAt: string; pages: Array<{ pageNumber: number }> } | null } | null;
  file: { id: string; sha256: string; sizeBytes: number; pageCount: number | null; mimeType: string } | null;
  linkedSentencia: Candidate | null;
  candidates: Candidate[];
  duplicateCandidates: Array<{ id: string; title: string; status: string; files: Array<{ id: string; sha256: string; pageCount: number | null; sizeBytes: number }>; linkedSentencias: Candidate[] }>;
  events: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; safeOutcome: unknown; createdAt: string; actor: { id: number; nombre: string; apellido: string | null } }>;
};
type QueueResponse = {
  data: Summary[];
  meta: { total: number; page: number; pageSize: number; pageCount: number; counters: { pending: number; ocrRequired: number; duplicates: number; reviewRequired: number; completed: number } };
};
type PageResponse = { data: Detail };

const statusLabels: Record<string, string> = {
  VALIDATING: "Validando PDF",
  METADATA_PENDING: "Revisar datos",
  DUPLICATE_EXACT: "PDF ya existente",
  OCR_REQUIRED: "Requiere OCR",
  MATCH_CANDIDATE: "Coincidencia exacta para confirmar",
  READY_TO_CREATE_DRAFT: "Listo para crear borrador",
  REVIEW_REQUIRED: "Requiere revisión",
  LINKED: "Vinculado a sentencia",
  DRAFT_CREATED: "Borrador creado",
  FAILED: "No se pudo ingresar",
  CANCELLED: "Ingreso cancelado",
};
const emptyMetadata: Metadata = { expediente: "", sala: "", fecha: "", caratula: "" };

export default function InstitutionalIngestionPage() {
  return (
    <ProtectedContent allowedRoles={["ADMIN", "OPERADOR", "JURISPRUDENCIA", "REVISOR"]}>
      <InstitutionalIngestionWorkspace />
    </ProtectedContent>
  );
}

function InstitutionalIngestionWorkspace() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [selectedSentenciaId, setSelectedSentenciaId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadQueue = useCallback(async (nextPage = page) => {
    setLoading(true);
    try {
      const result = await api.get<QueueResponse>("/corpus/institutional-ingestions", {
        query: { page: nextPage, pageSize: 25, status: filter || undefined, q: search.trim() || undefined },
      });
      setQueue(result);
      setPage(nextPage);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la cola.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, search]);

  const openDetail = useCallback(async (id: string) => {
    setError("");
    try {
      const result = await api.get<PageResponse>(`/corpus/institutional-ingestions/${encodeURIComponent(id)}`);
      setDetail(result.data);
      setMetadata(result.data.confirmedMetadata ?? emptyMetadata);
      setSelectedSentenciaId("");
      setNotice("");
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "No se pudo abrir el ingreso.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueue(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  const canUpload = useMemo(() => Boolean(selectedFile) && !busy, [busy, selectedFile]);

  const upload = async () => {
    if (!selectedFile) return;
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData();
    data.append("file", selectedFile);
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await api.post<PageResponse>("/corpus/institutional-ingestions/upload", data, {
        headers: { "Idempotency-Key": key },
      });
      setDetail(result.data);
      setMetadata(result.data.confirmedMetadata ?? emptyMetadata);
      setSelectedFile(null);
      const input = document.getElementById("institutional-pdf") as HTMLInputElement | null;
      if (input) input.value = "";
      setNotice(result.data.duplicateDetected ? "El PDF ya existe en Galilei; no se guardó una segunda copia." : "PDF recibido y validado. Completá los datos del fallo para continuar.");
      await loadQueue(1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo recibir el PDF.");
      await loadQueue(1);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: "metadata" | "link" | "draft" | "cancel" | "retry") => {
    if (!detail) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result: PageResponse;
      const path = `/corpus/institutional-ingestions/${encodeURIComponent(detail.id)}`;
      if (action === "metadata") result = await api.patch<PageResponse>(`${path}/metadata`, metadata);
      else if (action === "link") result = await api.post<PageResponse>(`${path}/link`, { sentenciaId: selectedSentenciaId });
      else if (action === "draft") result = await api.post<PageResponse>(`${path}/draft`);
      else if (action === "cancel") result = await api.post<PageResponse>(`${path}/cancel`);
      else result = await api.post<PageResponse>(`${path}/retry-extraction`);
      setDetail(result.data);
      setMetadata(result.data.confirmedMetadata ?? emptyMetadata);
      setSelectedSentenciaId("");
      setNotice(action === "metadata" ? "Datos confirmados. Revisá las coincidencias antes de vincular o crear un borrador." : action === "link" ? "PDF vinculado a la sentencia seleccionada." : action === "draft" ? "Borrador creado. Sigue sin publicar." : action === "cancel" ? "Ingreso cancelado." : "Extracción actualizada.");
      await loadQueue(1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const editableMetadata = detail && ["METADATA_PENDING", "OCR_REQUIRED", "DUPLICATE_EXACT"].includes(detail.status);
  const canChooseExisting = detail && ["MATCH_CANDIDATE", "REVIEW_REQUIRED"].includes(detail.status) && detail.candidates.length > 0;

  return (
    <main className={styles.page}>
      <PageHeader title="Ingreso de jurisprudencia" description="Recibí un PDF institucional, revisá sus datos y decidí si corresponde a un fallo existente o a un nuevo borrador." />
      {error ? <StatusMessage variant="error" title="No se pudo completar la acción" message={error} /> : null}
      {notice ? <StatusMessage variant="success" title="Ingreso actualizado" message={notice} /> : null}

      <div className={styles.columns}>
        <section className={styles.leftColumn} aria-label="Carga y cola de ingresos">
          <Card>
            <h2>Cargar un PDF</h2>
            <p className={styles.help}>Un archivo por vez. PDF de hasta 100 MB. La carga queda interna y no publica el fallo.</p>
            <label className={styles.fileLabel} htmlFor="institutional-pdf">
              Archivo PDF
              <span className={styles.filePicker}>
                <span className={styles.filePickerButton}>Seleccionar archivo PDF</span>
                <span className={styles.filePickerName} aria-live="polite">{selectedFile?.name ?? "Ningún archivo seleccionado"}</span>
              </span>
              <input
                id="institutional-pdf"
                className={styles.fileInput}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                disabled={busy}
                aria-describedby="institutional-pdf-help"
              />
            </label>
            <p id="institutional-pdf-help" className={styles.help}>Se valida tipo, estructura y páginas antes de aceptar el archivo.</p>
            {selectedFile ? <p className={styles.fileSummary}><strong>{selectedFile.name}</strong><span>{formatBytes(selectedFile.size)}</span></p> : null}
            <Button onClick={() => void upload()} disabled={!canUpload}>{busy ? "Procesando…" : "Recibir PDF"}</Button>
          </Card>

          <Card>
            <div className={styles.queueHeading}>
              <div><h2>Ingresos recientes</h2><p className={styles.help}>Cola paginada de trabajos individuales.</p></div>
              <Button variant="secondary" onClick={() => void loadQueue(1)} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</Button>
            </div>
            <div className={styles.metrics} aria-label="Resumen de ingresos">
              <Metric label="Pendientes" value={queue?.meta.counters.pending} />
              <Metric label="Requieren OCR" value={queue?.meta.counters.ocrRequired} />
              <Metric label="Duplicados" value={queue?.meta.counters.duplicates} />
              <Metric label="Revisión" value={queue?.meta.counters.reviewRequired} />
              <Metric label="Completados" value={queue?.meta.counters.completed} />
            </div>
            <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void loadQueue(1); }}>
              <label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Archivo o expediente" /></label>
              <label>Estado<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <Button type="submit" variant="secondary">Buscar</Button>
            </form>
            {loading && !queue ? <LoadingSpinner label="Cargando ingresos…" /> : queue?.data.length ? (
              <div className={styles.queue}>
                {queue.data.map((item) => (
                  <button key={item.id} type="button" className={`${styles.queueItem} ${detail?.id === item.id ? styles.queueItemActive : ""}`} onClick={() => void openDetail(item.id)} aria-current={detail?.id === item.id ? "true" : undefined}>
                    <span className={styles.queueTop}><strong>{item.originalFilename}</strong><span className={styles.status}>{statusLabels[item.status] ?? item.status}</span></span>
                    <span>{formatDate(item.createdAt)} · {formatBytes(item.sizeBytes)}{item.duplicateDetected ? " · ya existente" : ""}</span>
                  </button>
                ))}
                <div className={styles.pager}>
                  <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => void loadQueue(page - 1)}>Anterior</Button>
                  <span>{queue.meta.page} / {Math.max(1, queue.meta.pageCount)}</span>
                  <Button variant="secondary" disabled={page >= queue.meta.pageCount || loading} onClick={() => void loadQueue(page + 1)}>Siguiente</Button>
                </div>
              </div>
            ) : <EmptyState title="Todavía no hay ingresos" description="Los PDF recibidos van a aparecer acá con su estado y trazabilidad." />}
          </Card>
        </section>

        <section className={styles.detailColumn} aria-label="Detalle del ingreso">
          {!detail ? <Card><EmptyState title="Seleccioná un ingreso" description="El detalle muestra la extracción, coincidencias, decisiones disponibles e historial." /></Card> : (
            <Card>
              <div className={styles.detailHeader}>
                <div><p className={styles.eyebrow}>Ingreso individual</p><h2>{detail.originalFilename}</h2></div>
                <span className={styles.status}>{statusLabels[detail.status] ?? detail.status}</span>
              </div>
              <dl className={styles.fileFacts}>
                <div><dt>Tamaño</dt><dd>{formatBytes(detail.sizeBytes)}</dd></div>
                <div><dt>SHA-256</dt><dd className={styles.hash}>{detail.sha256}</dd></div>
                <div><dt>Extracción</dt><dd>{detail.extractionStatus ?? "Pendiente"}{detail.file?.pageCount ? ` · ${detail.file.pageCount} páginas` : ""}</dd></div>
                <div><dt>Visibilidad</dt><dd>{detail.document?.visibility ?? "Interna"}</dd></div>
              </dl>
              {detail.status === "OCR_REQUIRED" || detail.extractionStatus === "OCR_REQUIRED" ? <StatusMessage variant="info" title="Requiere OCR" message="El PDF queda preservado, pero no se inventó texto. Podés confirmar los metadatos mientras se revisa la extracción." /> : null}
              {detail.failureMessageSafe ? <StatusMessage variant={detail.status === "REVIEW_REQUIRED" ? "info" : "error"} title={detail.failureCode ?? "Revisión necesaria"} message={detail.failureMessageSafe} /> : null}
              {detail.duplicateDetected ? <StatusMessage variant="info" title="Archivo ya existente" message="Se reutiliza la identidad SHA-256. No se creó una segunda copia física." /> : null}
              {detail.duplicateCandidates.length ? <div className={styles.duplicateList}><h3>Archivo ya registrado</h3>{detail.duplicateCandidates.map((duplicate) => <div key={duplicate.id}><strong>{duplicate.title}</strong><span>Corpus {duplicate.id} · {duplicate.status}</span>{duplicate.linkedSentencias.map((sentence) => <span key={sentence.id}>Vinculado a: {sentence.expediente || sentence.caratula || `Sentencia ${sentence.id}`} · {sentence.sala || "Sala sin dato"}</span>)}</div>)}</div> : null}

              {editableMetadata ? <form className={styles.metadataForm} onSubmit={(event) => { event.preventDefault(); void runAction("metadata"); }}>
                <h3>Datos del fallo</h3>
                <p className={styles.help}>Estos datos los confirma una persona. El nombre del archivo y el texto extraído no se consideran identidad legal.</p>
                <label>Expediente<input required maxLength={150} value={metadata.expediente} onChange={(event) => setMetadata({ ...metadata, expediente: event.target.value })} placeholder="123/2026" /></label>
                <label>Sala<input required maxLength={100} value={metadata.sala} onChange={(event) => setMetadata({ ...metadata, sala: event.target.value })} /></label>
                <label>Fecha del fallo<input required type="date" value={metadata.fecha} onChange={(event) => setMetadata({ ...metadata, fecha: event.target.value })} /></label>
                <label>Carátula<input required maxLength={500} value={metadata.caratula} onChange={(event) => setMetadata({ ...metadata, caratula: event.target.value })} /></label>
                <details><summary>Datos adicionales</summary>
                  <label>Número de sentencia<input maxLength={100} value={metadata.numeroSentencia ?? ""} onChange={(event) => setMetadata({ ...metadata, numeroSentencia: event.target.value })} /></label>
                  <label>Tipo de fallo<input maxLength={100} value={metadata.tipoFallo ?? ""} onChange={(event) => setMetadata({ ...metadata, tipoFallo: event.target.value })} /></label>
                  <label>Tribunal<input maxLength={255} value={metadata.tribunalOrigen ?? ""} onChange={(event) => setMetadata({ ...metadata, tribunalOrigen: event.target.value })} /></label>
                  <label>Firmantes<input maxLength={500} value={metadata.magistrados ?? ""} onChange={(event) => setMetadata({ ...metadata, magistrados: event.target.value })} /></label>
                  <label>Observaciones internas<textarea maxLength={2000} value={metadata.observacionesInternas ?? ""} onChange={(event) => setMetadata({ ...metadata, observacionesInternas: event.target.value })} /></label>
                </details>
                <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Confirmar datos y buscar coincidencias"}</Button>
              </form> : null}

              {canChooseExisting ? <div className={styles.decision}>
                <h3>Coincidencias existentes</h3>
                <p className={styles.help}>{detail.matchClassification === "EXACT_UNIQUE" ? "Hay una coincidencia exacta. Confirmá manualmente el vínculo." : "Hay coincidencias parciales o múltiples. No se eligió ninguna automáticamente."}</p>
                {detail.candidates.map((candidate) => <label className={styles.candidate} key={candidate.id} aria-label={`Elegir ${candidate.caratula || `Sentencia ${candidate.id}`}`}>
                  <input type="radio" name="sentencia" value={candidate.id} checked={selectedSentenciaId === String(candidate.id)} onChange={() => setSelectedSentenciaId(String(candidate.id))} />
                  <span><strong>{candidate.caratula || `Sentencia ${candidate.id}`}</strong><small>{[candidate.expediente, candidate.numeroSentencia, candidate.sala, candidate.fecha ? formatDate(candidate.fecha) : null, candidate.estadoCarga].filter(Boolean).join(" · ")}</small></span>
                </label>)}
                <p className={styles.confirmSummary}><strong>Acción:</strong> Vincular el PDF a {selectedSentenciaId ? `la sentencia ${selectedSentenciaId}` : "la sentencia seleccionada"}. El estado de publicación se conserva.</p>
                <Button disabled={busy || !selectedSentenciaId} onClick={() => void runAction("link")}>{busy ? "Vinculando…" : "Confirmar vínculo"}</Button>
              </div> : null}

              {detail.status === "READY_TO_CREATE_DRAFT" ? <div className={styles.decision}>
                <h3>Sin coincidencias</h3>
                <p>No se encontraron coincidencias deterministas. Revisá el resumen y confirmá si querés crear una sentencia en borrador.</p>
                <div className={styles.confirmSummary}><strong>{detail.confirmedMetadata?.caratula}</strong><span>{[detail.confirmedMetadata?.expediente, detail.confirmedMetadata?.sala, detail.confirmedMetadata?.fecha].filter(Boolean).join(" · ")}</span><span>Acción: crear borrador interno. No se publica.</span></div>
                <Button disabled={busy} onClick={() => void runAction("draft")}>{busy ? "Creando borrador…" : "Crear sentencia en borrador"}</Button>
              </div> : null}

              {detail.linkedSentencia ? <StatusMessage variant="success" title={detail.status === "DRAFT_CREATED" ? "Borrador creado" : "Sentencia vinculada"} message={`${detail.linkedSentencia.expediente || detail.linkedSentencia.caratula || `Sentencia ${detail.linkedSentencia.id}`} · ${detail.linkedSentencia.publicado ? "Publicado previamente" : "Sin publicar"}`} /> : null}

              {detail.document?.id ? <p className={styles.documentLink}>Documento Corpus: <code>{detail.document.id}</code></p> : null}
              {detail.status !== "LINKED" && detail.status !== "DRAFT_CREATED" && detail.status !== "CANCELLED" ? <div className={styles.actions}>
                {detail.documentId && ["REVIEW_REQUIRED", "OCR_REQUIRED"].includes(detail.status) ? <Button variant="secondary" disabled={busy} onClick={() => void runAction("retry")}>Reintentar extracción</Button> : null}
                <Button variant="ghost" disabled={busy} onClick={() => void runAction("cancel")}>Cancelar ingreso</Button>
              </div> : null}

              <section className={styles.history} aria-label="Historial del ingreso">
                <h3>Historial</h3>
                {detail.events.length ? <ol>{detail.events.map((event) => <li key={event.id}><strong>{eventLabel(event.action)}</strong><span>{formatDate(event.createdAt, true)} · {event.actor.nombre} {event.actor.apellido ?? ""}</span></li>)}</ol> : <p>Sin eventos todavía.</p>}
              </section>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className={styles.metric}><strong>{value ?? "—"}</strong><span>{label}</span></div>;
}
function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("es-AR", includeTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short", timeZone: "UTC" }).format(new Date(value));
}
function eventLabel(action: string) {
  const labels: Record<string, string> = {
    UPLOAD_RECEIVED: "PDF recibido",
    PDF_VALIDATED: "PDF validado y extraído",
    DUPLICATE_DETECTED: "Se detectó el mismo archivo",
    UPLOAD_FAILED: "Carga fallida",
    REVIEW_REQUIRED: "Revisión requerida",
    METADATA_CONFIRMED: "Datos confirmados",
    SENTENCIA_LINKED: "Vinculado a sentencia existente",
    LINK_CONFIRMED_NOOP: "El vínculo ya existía",
    DRAFT_SENTENCIA_CREATED: "Sentencia creada en borrador",
    WORKFLOW_CANCELLED: "Ingreso cancelado",
    EXTRACTION_RETRIED: "Extracción reintentada",
  };
  return labels[action] ?? action;
}
