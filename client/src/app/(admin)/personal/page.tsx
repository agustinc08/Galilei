"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { LineIcon } from "@/components/ui/LineIcon";
import { CorpusPdfViewer } from "../corpus/[id]/CorpusPdfViewer";
import styles from "./personal.module.css";
import {
  inspectPersonalFolderFiles,
  type PersonalFolderFile,
  type PersonalFolderOmission,
  type PersonalFolderSelection,
} from "./personal-folder-upload";

type PersonalFolder = {
  id: string;
  parentId: string | null;
  name: string;
  visibilityLabel: string;
  _count: { documents: number; children: number };
};
type ShareWorkspace = {
  id: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
};
type PersonalDocument = {
  documentId: string;
  createdAt: string;
  folder: { id: string; name: string } | null;
  document: {
    title: string;
    status: string;
    file: { filename: string; mimeType: string; sizeBytes: number } | null;
    extraction: { status: string; pageCount: number } | null;
  };
};
type SearchResult = {
  sourceId: string;
  title: string | null;
  snippet: string | null;
  metadata: Record<string, string | number | boolean | null>;
};
type FolderUploadOutcome = {
  name: string;
  status: "ADDED" | "DUPLICATE" | "ERROR";
  message?: string;
};
type FolderUploadReport = {
  total: number;
  processed: number;
  added: number;
  duplicates: number;
  errors: number;
  omitted: PersonalFolderOmission[];
  outcomes: FolderUploadOutcome[];
  done: boolean;
};

function folderLookupKey(parentId: string | null, name: string) {
  return `${parentId ?? "ROOT"}\u0000${name}`;
}

export default function PersonalDocumentsPage() {
  const [folders, setFolders] = useState<PersonalFolder[]>([]);
  const [documents, setDocuments] = useState<PersonalDocument[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [newFolder, setNewFolder] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [folderSelection, setFolderSelection] = useState<PersonalFolderSelection>({ files: [], omitted: [], errors: [] });
  const [folderReport, setFolderReport] = useState<FolderUploadReport | null>(null);
  const [directoryPickerSupported, setDirectoryPickerSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageCount, setPreviewPageCount] = useState(0);
  const [shareableWorkspaces, setShareableWorkspaces] = useState<ShareWorkspace[]>([]);
  const [shareDialogDocumentId, setShareDialogDocumentId] = useState<string | null>(null);
  const [shareWorkspaceId, setShareWorkspaceId] = useState("");

  const visibleFolders = useMemo(() => folders.filter((folder) => folder.parentId === folderId), [folders, folderId]);
  const parentId = folderId ? folders.find((folder) => folder.id === folderId)?.parentId ?? null : null;
  const currentPath = useMemo(() => {
    const segments: string[] = [];
    let current = folderId;
    while (current) {
      const folder = folders.find((item) => item.id === current);
      if (!folder) break;
      segments.unshift(folder.name);
      current = folder.parentId;
    }
    return segments;
  }, [folderId, folders]);

  const loadPersonalData = useCallback((currentFolderId: string | null) => Promise.all([
      api.get<PersonalFolder[]>("personal/folders"),
      api.get<PersonalDocument[]>("personal/documents", { query: { folderId: currentFolderId ?? "ROOT" } }),
    ]), []);

  const refresh = useCallback(async () => {
    const [nextFolders, nextDocuments] = await loadPersonalData(folderId);
    setFolders(nextFolders);
    setDocuments(nextDocuments);
  }, [folderId, loadPersonalData]);

  function navigateToFolder(nextFolderId: string | null) {
    setLoading(true);
    setLoadError("");
    setError("");
    setSearchResults(null);
    setFolderId(nextFolderId);
  }

  useEffect(() => {
    let active = true;
    void loadPersonalData(folderId)
      .then(([nextFolders, nextDocuments]) => {
        if (!active) return;
        setFolders(nextFolders);
        setDocuments(nextDocuments);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(message(cause));
          setLoadError("No pudimos cargar esta carpeta.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [folderId, loadPersonalData, loadAttempt]);

  useEffect(() => {
    setDirectoryPickerSupported("webkitdirectory" in document.createElement("input"));
  }, []);

  useEffect(() => {
    let active = true;
    void api.get<ShareWorkspace[]>("workspaces/mine")
      .then((rows) => {
        if (!active) return;
        const eligible = rows.filter((workspace) => workspace.role === "ADMIN" || workspace.role === "EDITOR");
        setShareableWorkspaces(eligible);
        setShareWorkspaceId((current) => eligible.some((workspace) => workspace.id === current) ? current : eligible[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newFolder.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("personal/folders", { name: newFolder, parentId: folderId });
      setNewFolder("");
      setNotice("La carpeta quedó guardada en Mis documentos.");
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFiles.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData();
    selectedFiles.forEach((file) => form.append("files", file, file.name));
    try {
      const result = await api.post<{ destination: string; access: string; results: Array<{ status: string; title?: string; message?: string }> }>(
        `personal/documents/upload${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
        form,
      );
      const failed = result.results.filter((item) => item.status === "ERROR");
      setNotice(failed.length ? `Se cargaron ${result.results.length - failed.length} archivo(s); ${failed.length} no se pudieron procesar.` : `${result.results.length} archivo(s) guardado(s) en ${result.destination}. Acceso: ${result.access}.`);
      if (failed.length) setError(failed.map((item) => item.message).filter(Boolean).join(" "));
      setSelectedFiles([]);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectFolderFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = inspectPersonalFolderFiles(Array.from(event.currentTarget.files ?? []));
    setFolderSelection(selected);
    setFolderReport(null);
    setNotice("");
    setError("");
    event.currentTarget.value = "";
  }

  async function uploadFolder() {
    if (!folderSelection.files.length || busy) return;
    const entries = folderSelection.files;
    const outcomes: FolderUploadOutcome[] = folderSelection.errors.map((item) => ({
      name: item.name,
      status: "ERROR",
      message: item.reason,
    }));
    const report: FolderUploadReport = {
      total: entries.length + outcomes.length,
      processed: outcomes.length,
      added: 0,
      duplicates: 0,
      errors: outcomes.length,
      omitted: folderSelection.omitted,
      outcomes,
      done: false,
    };
    setFolderReport(report);
    setBusy(true);
    setError("");
    setNotice("");

    const recordOutcome = (outcome: FolderUploadOutcome) => {
      outcomes.push(outcome);
      setFolderReport((current) => current ? {
        ...current,
        processed: current.processed + 1,
        added: current.added + Number(outcome.status === "ADDED"),
        duplicates: current.duplicates + Number(outcome.status === "DUPLICATE"),
        errors: current.errors + Number(outcome.status === "ERROR"),
        outcomes: [...outcomes],
      } : current);
    };

    try {
      const folderIds = new Map<string, string>();
      folders.forEach((folder) => folderIds.set(folderLookupKey(folder.parentId, folder.name), folder.id));
      const uploadsByFolder = new Map<string, { folderId: string | null; files: PersonalFolderFile[] }>();

      for (const entry of entries) {
        try {
          let destinationFolderId = folderId;
          for (const name of entry.relativeFolders) {
            const key = folderLookupKey(destinationFolderId, name);
            let childId = folderIds.get(key);
            if (!childId) {
              const created = await api.post<{ id: string }>("personal/folders", {
                name,
                parentId: destinationFolderId,
              });
              childId = created.id;
              folderIds.set(key, childId);
            }
            destinationFolderId = childId;
          }
          const groupKey = destinationFolderId ?? "ROOT";
          const group = uploadsByFolder.get(groupKey) ?? { folderId: destinationFolderId, files: [] };
          group.files.push(entry);
          uploadsByFolder.set(groupKey, group);
        } catch (cause) {
          recordOutcome({ name: entry.displayPath, status: "ERROR", message: message(cause) });
        }
      }

      for (const group of uploadsByFolder.values()) {
        for (let start = 0; start < group.files.length; start += 5) {
          const batch = group.files.slice(start, start + 5);
          const form = new FormData();
          batch.forEach(({ file }) => form.append("files", file, file.name));
          const endpoint = `personal/documents/folder-upload${group.folderId ? `?folderId=${encodeURIComponent(group.folderId)}` : ""}`;
          try {
            const result = await api.post<{ results: Array<{ status: string; duplicate?: boolean; message?: string }> }>(endpoint, form);
            batch.forEach((entry, index) => {
              const item = result.results[index];
              if (!item) {
                recordOutcome({ name: entry.displayPath, status: "ERROR", message: "No recibimos el resultado de este archivo." });
              } else if (item.status === "ERROR") {
                recordOutcome({ name: entry.displayPath, status: "ERROR", message: item.message || "No se pudo procesar este archivo." });
              } else {
                recordOutcome({ name: entry.displayPath, status: item.duplicate ? "DUPLICATE" : "ADDED" });
              }
            });
          } catch (cause) {
            batch.forEach((entry) => recordOutcome({ name: entry.displayPath, status: "ERROR", message: message(cause) }));
          }
        }
      }

      const finished = { ...report, processed: outcomes.length, added: outcomes.filter((item) => item.status === "ADDED").length,
        duplicates: outcomes.filter((item) => item.status === "DUPLICATE").length,
        errors: outcomes.filter((item) => item.status === "ERROR").length, outcomes: [...outcomes], done: true };
      setFolderReport(finished);
      setNotice(`${finished.added} documento(s) incorporado(s); ${finished.duplicates} ya estaban guardados; ${finished.omitted.length} omitidos; ${finished.errors} con error.`);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.get<{ total: number; results: SearchResult[] }>("personal/search", {
        query: { q: query, folderId: folderId ?? undefined, pageSize: 100 },
      });
      setSearchResults(result.results);
      setTotal(result.total);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function preview(documentId: string, title: string) {
    setBusy(true);
    setError("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewId(documentId);
    setPreviewTitle(title);
    setPreviewPage(1);
    setPreviewPageCount(0);
    try {
      const blob = await api.download(`personal/documents/${documentId}/file`);
      setPreviewType(blob.type);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setPreviewUrl(null);
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(documentId: string, filename: string) {
    try {
      const blob = await api.download(`personal/documents/${documentId}/file`, { query: { download: true } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(message(cause));
    }
  }

  function openShareDialog(documentId: string) {
    if (!shareableWorkspaces.length) return;
    setShareWorkspaceId((current) => shareableWorkspaces.some((workspace) => workspace.id === current) ? current : shareableWorkspaces[0].id);
    setShareDialogDocumentId(documentId);
  }

  async function sharePersonalDocument() {
    if (!shareDialogDocumentId || !shareWorkspaceId) return;
    const destination = shareableWorkspaces.find((workspace) => workspace.id === shareWorkspaceId);
    if (!destination) return;
    setBusy(true);
    setError("");
    try {
      await api.patch(`personal/documents/${shareDialogDocumentId}/share`, {
        workspaceId: destination.id,
        confirmAccessChange: true,
      });
      setShareDialogDocumentId(null);
      setSearchResults(null);
      setQuery("");
      setNotice(`El documento ahora está compartido con ${destination.name}.`);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const results = searchResults ?? documents.map((row) => ({
    sourceId: row.documentId,
    title: row.document.title,
    snippet: null,
    metadata: { filename: row.document.file?.filename ?? row.document.title, status: row.document.status },
  }));

  return (
    <div className={styles.page}>
      <PageHeader title="Mis documentos" description="Sólo vos podés verlos." />
      <div className={styles.privateNotice} role="note">
        <LineIcon name="lock" className={styles.privateIcon} />
        <div><strong>Acceso privado</strong><span>Estos documentos pertenecen a tu cuenta y no aparecen en las salas, juzgados ni en la búsqueda general.</span></div>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.columns}>
        <section className={styles.left} aria-label="Carpetas y documentos personales">
          <Card>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Carpetas</h2>
                <p>Privadas para vos</p>
              </div>
              {folderId ? <button className={styles.secondary} onClick={() => navigateToFolder(parentId)}>Volver</button> : null}
            </div>
            <div className={styles.breadcrumb} aria-label="Ubicación actual">
              <button onClick={() => navigateToFolder(null)}>Mis documentos</button>
              {currentPath.map((name, index) => <span key={`${name}-${index}`}>› {name}</span>)}
            </div>
            <ul className={styles.folderList}>
              {visibleFolders.map((folder) => (
                <li key={folder.id}>
                  <button className={styles.folderButton} onClick={() => navigateToFolder(folder.id)}>
                    <LineIcon name="folder" className={styles.folderIcon} /><span>{folder.name}</span><small>{folder._count.documents}</small>
                  </button>
                </li>
              ))}
              {loading ? <li className={styles.empty} aria-hidden="true">Cargando carpetas…</li> : null}
              {!loading && !loadError && !visibleFolders.length ? <li className={styles.empty}>Todavía no hay carpetas acá.</li> : null}
            </ul>
            <form className={styles.inlineForm} onSubmit={createFolder}>
              <label htmlFor="personal-folder-name">Nueva carpeta</label>
              <div><input id="personal-folder-name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} maxLength={100} />
                <button className={styles.secondary} disabled={busy || !newFolder.trim()}>Crear</button></div>
            </form>
          </Card>

          <Card>
            <h2>Subir carpeta completa</h2>
            <p className={styles.folderHelp}>
              Elegí una carpeta de tu equipo. Galilei conserva sus subcarpetas e incorpora únicamente PDF, DOC y DOCX válidos. Cada archivo puede pesar hasta 20 MiB.
            </p>
            <div className={styles.uploadPromise}>
              <span><strong>Destino:</strong> {folderId ? currentPath.join(" › ") : "Mis documentos"}</span>
              <span><strong>Acceso:</strong> Sólo vos</span>
            </div>
            <div className={styles.folderUpload}>
              <input
                ref={(element) => {
                  element?.setAttribute("webkitdirectory", "");
                }}
                id="personal-folder-upload"
                className={styles.filePickerInput}
                type="file"
                multiple
                accept=".pdf,.doc,.docx"
                onChange={selectFolderFiles}
                disabled={!directoryPickerSupported || busy}
                aria-describedby="personal-folder-upload-help"
                aria-label="Carpeta del equipo"
              />
              <label className={styles.filePicker} htmlFor="personal-folder-upload">
                <span className={styles.filePickerButton}>Elegir carpeta</span>
                <span className={styles.filePickerSummary} aria-live="polite">
                  {folderSelection.files.length
                    ? `${folderSelection.files.length} documento(s) válidos · ${folderSelection.omitted.length} omitidos`
                    : "Todavía no elegiste una carpeta"}
                </span>
              </label>
              <p id="personal-folder-upload-help" className={styles.fieldHelp}>
                Se omiten imágenes, archivos ocultos o temporales, ejecutables y archivos comprimidos. El contenido se valida antes de guardarlo.
              </p>
              {!directoryPickerSupported ? <p className={styles.fieldHelp}>Este navegador no permite elegir carpetas. Abrí Galilei en un navegador compatible para usar esta opción.</p> : null}
              {folderSelection.files.length || folderSelection.omitted.length || folderSelection.errors.length ? (
                <p className={styles.selectionSummary} role="status">
                  {folderSelection.files.length} documento(s) listos; {folderSelection.omitted.length} omitidos y {folderSelection.errors.length} con error previo.
                </p>
              ) : null}
              {folderSelection.omitted.length ? (
                <details className={styles.fileDetails}>
                  <summary>Ver archivos omitidos ({folderSelection.omitted.length})</summary>
                  <ul>{folderSelection.omitted.slice(0, 50).map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><small>{item.reason}</small></li>)}</ul>
                </details>
              ) : null}
              {folderSelection.errors.length ? (
                <details className={styles.fileDetails}>
                  <summary>Ver archivos con error antes de cargar ({folderSelection.errors.length})</summary>
                  <ul>{folderSelection.errors.slice(0, 50).map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><small>{item.reason}</small></li>)}</ul>
                </details>
              ) : null}
              <button className={styles.primary} type="button" onClick={() => void uploadFolder()} disabled={busy || !folderSelection.files.length}>
                {busy && folderReport && !folderReport.done ? "Procesando carpeta…" : "Incorporar documentos válidos"}
              </button>
              {folderReport ? (
                <div className={styles.folderProgress}>
                  <p role="status" aria-live="polite">
                    {folderReport.done ? "Carpeta procesada." : "Analizando carpeta…"} {folderReport.processed} procesados, {Math.max(0, folderReport.total - folderReport.processed)} pendientes, {folderReport.omitted.length} omitidos y {folderReport.errors} con error.
                  </p>
                  <progress max={Math.max(1, folderReport.total)} value={folderReport.processed} aria-label="Progreso de carga de carpeta" />
                  <p className={styles.fieldHelp}>{folderReport.added} incorporados · {folderReport.duplicates} ya estaban guardados</p>
                  {folderReport.outcomes.length ? (
                    <details className={styles.fileDetails}>
                      <summary>Ver resultado por documento ({folderReport.outcomes.length})</summary>
                      <ul>{folderReport.outcomes.slice(0, 100).map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><small>{item.status === "ADDED" ? "Incorporado" : item.status === "DUPLICATE" ? "Ya estaba guardado" : item.message || "No se pudo procesar"}</small></li>)}</ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <h2>Subir documentos individuales</h2>
            <p className={styles.fieldHelp}>Para archivos sueltos, también se admiten TXT, RTF y ODT.</p>
            <form className={styles.uploadForm} onSubmit={uploadFiles}>
              <label htmlFor="personal-upload-files">Elegí uno o más documentos</label>
              <input id="personal-upload-files" className={styles.filePickerInput} type="file" multiple accept=".pdf,.txt,.rtf,.doc,.docx,.odt" onChange={(event) => setSelectedFiles(Array.from(event.currentTarget.files ?? []))} />
              <label className={styles.filePicker} htmlFor="personal-upload-files">
                <span className={styles.filePickerButton}>Elegir archivos</span>
                <span className={styles.filePickerSummary} aria-live="polite">
                  {selectedFiles.length
                    ? `${selectedFiles.length} archivo(s) seleccionado(s)`
                    : "Todavía no elegiste archivos"}
                </span>
              </label>
              <button className={styles.primary} disabled={busy || !selectedFiles.length}>{busy ? "Procesando…" : "Guardar en Mis documentos"}</button>
            </form>
          </Card>
        </section>

        <section className={styles.right} aria-label="Buscar y ver documentos personales">
          <Card>
            <form className={styles.searchForm} onSubmit={search}>
              <label htmlFor="personal-search">Buscar en Mis documentos</label>
              <div><input id="personal-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Palabra o frase" />
                <button className={styles.primary} disabled={busy || !query.trim()}>Buscar</button></div>
            </form>
            <div className={styles.resultsHeader}>
              <h2>{searchResults ? `Resultados (${total})` : "Documentos"}</h2>
              {searchResults ? <button className={styles.secondary} onClick={() => setSearchResults(null)}>Ver carpeta</button> : null}
            </div>
            <ul className={styles.documentList}>
              {loading ? <li className={styles.empty} role="status">Cargando documentos…</li> : null}
              {!loading && loadError ? (
                <li className={styles.empty}>
                  <span role="alert">No pudimos cargar tus documentos.</span>{" "}
                  <button className={styles.textButton} type="button" onClick={() => {
                    setError("");
                    setLoading(true);
                    setLoadError("");
                    setLoadAttempt((attempt) => attempt + 1);
                  }}>Reintentar</button>
                </li>
              ) : null}
              {!loading && !loadError ? results.map((result) => {
                const filename = String(result.metadata.filename ?? result.title ?? "documento");
                return <li key={result.sourceId}>
                  <div><strong>{result.title ?? filename}</strong><span>{filename}</span>{result.snippet ? <p>{result.snippet}</p> : null}</div>
                  <div className={styles.rowActions}>
                    <button className={styles.secondary} onClick={() => void preview(result.sourceId, result.title ?? filename)}>Vista previa</button>
                    <button className={styles.textButton} onClick={() => void downloadFile(result.sourceId, filename)}>Descargar</button>
                    {shareableWorkspaces.length ? <button className={styles.secondary} onClick={() => openShareDialog(result.sourceId)}>Compartir con una dependencia</button> : null}
                  </div>
                </li>;
              }) : null}
              {!loading && !loadError && !results.length ? <li className={styles.empty}>{searchResults ? "No encontramos documentos con ese texto." : "Todavía no hay documentos en esta carpeta."}</li> : null}
            </ul>
          </Card>

          <Card>
            <div className={styles.sectionHeader}><div><h2>Vista previa</h2><p>{previewTitle || "Elegí un documento para verlo."}</p></div></div>
            {previewUrl && previewType === "application/pdf" && previewId ? <>
              <div className={styles.previewControls}>
                <button className={styles.secondary} type="button" disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}>Página anterior</button>
                <span>{previewPageCount ? `Página ${previewPage} de ${previewPageCount}` : `Página ${previewPage}`}</span>
                <button className={styles.secondary} type="button" disabled={!!previewPageCount && previewPage >= previewPageCount} onClick={() => setPreviewPage((page) => page + 1)}>Página siguiente</button>
              </div>
              <div className={styles.pdfPreview}>
                <CorpusPdfViewer
                  file={previewUrl}
                  page={previewPage}
                  matches={[]}
                  activeMatch={0}
                  onLoadSuccess={setPreviewPageCount}
                  structurePath={`personal/documents/${previewId}/structure`}
                  onGoToPage={setPreviewPage}
                />
              </div>
            </> : previewUrl ? <div className={styles.filePreview}><p>La vista previa de este formato no está disponible en el navegador.</p><button className={styles.secondary} onClick={() => previewId && void downloadFile(previewId, previewTitle)}>Descargar documento</button></div> : <div className={styles.previewEmpty}>La vista previa se abrirá acá.</div>}
          </Card>
        </section>
      </div>
      {shareDialogDocumentId ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={styles.modal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="personal-share-title"
            aria-describedby="personal-share-description"
          >
            <h2 id="personal-share-title">Confirmar cambio de acceso</h2>
            <label htmlFor="personal-share-workspace">Compartir con</label>
            <select
              id="personal-share-workspace"
              value={shareWorkspaceId}
              onChange={(event) => setShareWorkspaceId(event.target.value)}
            >
              {shareableWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
            <p id="personal-share-description">
              {shareableWorkspaces.find((workspace) => workspace.id === shareWorkspaceId)
                ? `Al compartir este documento, los integrantes autorizados de ${shareableWorkspaces.find((workspace) => workspace.id === shareWorkspaceId)?.name} podrán encontrarlo, verlo y descargarlo.`
                : "Elegí una dependencia para compartir este documento."}
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => setShareDialogDocumentId(null)}>Cancelar</button>
              <button className={styles.primary} type="button" disabled={busy || !shareWorkspaceId} onClick={() => void sharePersonalDocument()}>Compartir documento</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function message(cause: unknown) {
  return cause instanceof ApiError ? cause.message : "No pudimos completar esta acción. Intentá nuevamente.";
}
