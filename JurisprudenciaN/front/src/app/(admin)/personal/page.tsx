"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import styles from "./personal.module.css";

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

export default function PersonalDocumentsPage() {
  const [folders, setFolders] = useState<PersonalFolder[]>([]);
  const [documents, setDocuments] = useState<PersonalDocument[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [newFolder, setNewFolder] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
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

  useEffect(() => {
    let active = true;
    void loadPersonalData(folderId)
      .then(([nextFolders, nextDocuments]) => {
        if (!active) return;
        setFolders(nextFolders);
        setDocuments(nextDocuments);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      });
    return () => { active = false; };
  }, [folderId, loadPersonalData]);

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
    if (!selectedFiles?.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData();
    Array.from(selectedFiles).forEach((file) => form.append("files", file));
    try {
      const result = await api.post<{ destination: string; access: string; results: Array<{ status: string; title?: string; message?: string }> }>(
        `personal/documents/upload${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
        form,
      );
      const failed = result.results.filter((item) => item.status === "ERROR");
      setNotice(failed.length ? `Se cargaron ${result.results.length - failed.length} archivo(s); ${failed.length} no se pudieron procesar.` : `${result.results.length} archivo(s) guardado(s) en ${result.destination}. Acceso: ${result.access}.`);
      if (failed.length) setError(failed.map((item) => item.message).filter(Boolean).join(" "));
      setSelectedFiles(null);
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
        <span aria-hidden="true">🔒</span>
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
              {folderId ? <button className={styles.secondary} onClick={() => setFolderId(parentId)}>Volver</button> : null}
            </div>
            <div className={styles.breadcrumb} aria-label="Ubicación actual">
              <button onClick={() => setFolderId(null)}>Mis documentos</button>
              {currentPath.map((name, index) => <span key={`${name}-${index}`}>› {name}</span>)}
            </div>
            <ul className={styles.folderList}>
              {visibleFolders.map((folder) => (
                <li key={folder.id}>
                  <button className={styles.folderButton} onClick={() => { setFolderId(folder.id); setSearchResults(null); }}>
                    <span aria-hidden="true">📁</span><span>{folder.name}</span><small>{folder._count.documents}</small>
                  </button>
                </li>
              ))}
              {!visibleFolders.length ? <li className={styles.empty}>Todavía no hay carpetas acá.</li> : null}
            </ul>
            <form className={styles.inlineForm} onSubmit={createFolder}>
              <label htmlFor="personal-folder-name">Nueva carpeta</label>
              <div><input id="personal-folder-name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} maxLength={100} />
                <button className={styles.secondary} disabled={busy || !newFolder.trim()}>Crear</button></div>
            </form>
          </Card>

          <Card>
            <h2>Subir documento</h2>
            <div className={styles.uploadPromise}>
              <span><strong>Destino:</strong> {folderId ? currentPath.join(" › ") : "Mis documentos"}</span>
              <span><strong>Acceso:</strong> Sólo vos</span>
            </div>
            <form className={styles.uploadForm} onSubmit={uploadFiles}>
              <label htmlFor="personal-upload-files">Elegí uno o más documentos</label>
              <input id="personal-upload-files" type="file" multiple accept=".pdf,.txt,.rtf,.doc,.docx,.odt" onChange={(event) => setSelectedFiles(event.target.files)} />
              <button className={styles.primary} disabled={busy || !selectedFiles?.length}>{busy ? "Procesando…" : "Guardar en Mis documentos"}</button>
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
              {results.map((result) => {
                const filename = String(result.metadata.filename ?? result.title ?? "documento");
                return <li key={result.sourceId}>
                  <div><strong>{result.title ?? filename}</strong><span>{filename}</span>{result.snippet ? <p>{result.snippet}</p> : null}</div>
                  <div className={styles.rowActions}>
                    <button className={styles.secondary} onClick={() => void preview(result.sourceId, result.title ?? filename)}>Vista previa</button>
                    <button className={styles.textButton} onClick={() => void downloadFile(result.sourceId, filename)}>Descargar</button>
                    {shareableWorkspaces.length ? <button className={styles.secondary} onClick={() => openShareDialog(result.sourceId)}>Compartir con una dependencia</button> : null}
                  </div>
                </li>;
              })}
              {!results.length ? <li className={styles.empty}>{searchResults ? "No encontramos documentos con ese texto." : "Todavía no hay documentos en esta carpeta."}</li> : null}
            </ul>
          </Card>

          <Card>
            <div className={styles.sectionHeader}><div><h2>Vista previa</h2><p>{previewTitle || "Elegí un documento para verlo."}</p></div></div>
            {previewUrl && previewType === "application/pdf" ? <iframe className={styles.preview} title={`Vista previa de ${previewTitle}`} src={previewUrl} /> : previewUrl ? <div className={styles.filePreview}><p>La vista previa de este formato no está disponible en el navegador.</p><button className={styles.secondary} onClick={() => previewId && void downloadFile(previewId, previewTitle)}>Descargar documento</button></div> : <div className={styles.previewEmpty}>La vista previa se abrirá acá.</div>}
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
