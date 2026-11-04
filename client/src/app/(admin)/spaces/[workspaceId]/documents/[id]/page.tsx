"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "@/lib/router-compat"
import { Link } from "@/lib/router-compat";
import { useParams, useSearchParams } from "@/lib/router-compat";
import { api, ApiError } from "@/lib/api";
import { downloadBlob } from "@/lib/utils";
import { clampPdfPage, parsePdfPageParam } from "@/lib/pdf-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { PdfMatch } from "@/app/(admin)/corpus/[id]/CorpusPdfViewer";
import styles from "../../../copernic-search.module.css";

const CorpusPdfViewer = dynamic(
  () =>
    import("@/app/(admin)/corpus/[id]/CorpusPdfViewer").then(
      (module) => module.CorpusPdfViewer,
    ),
  { ssr: false, loading: () => <p>Cargando documento…</p> },
);

type DocumentInfo = {
  id: string;
  title: string;
  status: string;
  file: {
    filename: string;
    pageCount?: number | null;
    mimeType: string;
  } | null;
  extraction: { status: string; pageCount: number } | null;
  workspaceOcr?: {
    state: "NOT_REQUIRED" | "NEEDS_OCR" | "PENDING" | "PROCESSING" | "COMPLETED" | "ERROR";
    canStart: boolean;
    canRetry: boolean;
  };
  selectedPage?: { pageNumber: number; text: string; textKind?: 'NATIVE' | 'OCR' };
};
type Matches = {
  total: number;
  returned: number;
  exactTotalKnown: boolean;
  truncated: boolean;
  matches: Array<PdfMatch & {
    context: string;
    contextBefore: string;
    contextAfter: string;
    text: string;
    kind: "TERM" | "PHRASE";
    pageOccurrenceOrdinal: number;
    total: number;
  }>;
};

function fileTypeLabel(mimeType: string | undefined) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "text/plain") return "TXT";
  if (mimeType === "application/rtf" || mimeType === "text/rtf") return "RTF";
  if (mimeType === "application/msword") return "DOC";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  if (mimeType === "application/vnd.oasis.opendocument.text") return "ODT";
  return "documento";
}
function renderTextMatch(
  text: string,
  matches: Matches["matches"],
  page: number,
  activeOrdinal?: number,
) {
  const ordered = matches
    .filter((match) => match.page === page)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const output: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of ordered) {
    const start = Math.max(cursor, match.start);
    const end = Math.min(text.length, match.end);
    if (end <= start) continue;
    if (start > cursor) output.push(text.slice(cursor, start));
    output.push(
      <mark className={match.ordinal === activeOrdinal ? "bjc-text-match-current" : "bjc-text-match"} key={`${match.ordinal}-${start}-${end}`}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function viewerError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return "Tu sesión venció. Volvé a ingresar.";
    if (cause.status === 403 || cause.status === 404)
      return "No encontramos este documento o no tenés acceso.";
    if (cause.status >= 500)
      return "Ocurrió un problema al abrir el documento. Podés volver a intentarlo.";
  }
  return fallback;
}

function workspaceOcrError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 403)
      return "Solo un editor o administrador de la dependencia puede iniciar el OCR.";
    if (cause.status === 404 || cause.status === 409)
      return "Este documento no está disponible para reconocimiento de texto.";
    if (cause.status === 429)
      return "La cola de reconocimiento está ocupada. Volvé a intentarlo más tarde.";
  }
  return "No pudimos iniciar el reconocimiento. El PDF original sigue disponible.";
}

export default function WorkspaceDocumentViewer() {
  const params = useParams<{ workspaceId: string; id: string }>();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const workspaceName = searchParams.get("workspaceName");
  const backParams = new URLSearchParams();
  for (const key of [
    "workspaceId",
    "folderId",
    "sourceId",
    "sourceFolder",
    "type",
    "datePreset",
    "dateFrom",
    "dateTo",
    "q",
    "searchFolderMode",
    "selected",
    "match",
  ]) {
    const value = searchParams.get(key);
    if (value !== null) backParams.set(key, value);
  }
  const previousSearchPage = searchParams.get("searchPage");
  if (previousSearchPage) backParams.set("page", previousSearchPage);
  const backHref = `/spaces${backParams.size ? `?${backParams.toString()}` : ""}`;
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<Matches | null>(null);
  const [page, setPage] = useState(() => parsePdfPageParam(searchParams.get("page")));
  const [pageCount, setPageCount] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [ocrConfirming, setOcrConfirming] = useState(false);
  const [ocrSubmitting, setOcrSubmitting] = useState(false);
  const [ocrActionError, setOcrActionError] = useState("");
  const effectivePageCount =
    pageCount || document?.extraction?.pageCount || document?.file?.pageCount || 0;
  const isPdf = document?.file?.mimeType === "application/pdf";
  const ocrDocumentId = document?.id;
  const ocrState = document?.workspaceOcr?.state;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [page]);

  useEffect(() => {
    let alive = true;
    void api.get<DocumentInfo>(
      `/workspaces/${params.workspaceId}/documents/${params.id}`,
      { query: { pageNumber: page } },
    )
      .then((info) => {
        if (alive) {
          setDocument(info);
          const knownPageCount = info.extraction?.pageCount ?? info.file?.pageCount ?? 0;
          if (knownPageCount > 0) setPage((current) => clampPdfPage(current, knownPageCount));
        }
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(viewerError(cause, "No se pudo abrir este documento."));
      });
    return () => {
      alive = false;
    };
  }, [params.workspaceId, params.id, page]);

  useEffect(() => {
    if (
      !ocrDocumentId ||
      (ocrState !== "PENDING" && ocrState !== "PROCESSING")
    ) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refreshStatus = async () => {
      try {
        const next = await api.get<DocumentInfo>(
          `/workspaces/${params.workspaceId}/documents/${params.id}`,
          { query: { pageNumber: page } },
        );
        if (alive) setDocument(next);
      } catch {
        // Keep polling through transient network errors.
      }
      if (alive) timer = setTimeout(() => void refreshStatus(), 1500);
    };
    timer = setTimeout(() => void refreshStatus(), 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ocrDocumentId, ocrState, params.workspaceId, params.id, page]);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void api.download(
      `/workspaces/${params.workspaceId}/documents/${params.id}/file`,
    )
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setPdf(objectUrl);
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(viewerError(cause, "No se pudo abrir este documento."));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.workspaceId, params.id]);

  const findMatches = useCallback(async () => {
    if (!query.trim()) {
      setMatches(null);
      return;
    }
    try {
      const data = await api.get<Matches>(
        `/workspaces/${params.workspaceId}/documents/${params.id}/matches`,
        { query: { q: query } },
      );
      setMatches(data);
      const cameFromSearch = searchParams.has("searchPage");
      const requestedOrdinal = Math.max(1, Number(searchParams.get("match") ?? 1));
      const requestedIndex = cameFromSearch
        ? data.matches.findIndex((match) => match.ordinal === requestedOrdinal)
        : 0;
      const nextIndex = requestedIndex >= 0 ? requestedIndex : 0;
      setActive(nextIndex);
      if (data.matches[nextIndex]) setPage(data.matches[nextIndex].page);
    } catch (cause) {
      setError(viewerError(cause, "No se pudo buscar dentro del documento."));
    }
  }, [params.id, params.workspaceId, query, searchParams]);
  async function downloadPdf() {
    try {
      const blob = await api.download(
        `/workspaces/${params.workspaceId}/documents/${params.id}/file?download=true`,
      );
      downloadBlob(blob, document?.file?.filename ?? "documento");
    } catch (cause) {
      setError(viewerError(cause, "No se pudo descargar este documento."));
    }
  }

  async function startWorkspaceOcr() {
    if (!document?.workspaceOcr?.canStart || ocrSubmitting) return;
    setOcrSubmitting(true);
    setOcrActionError("");
    try {
      const result = await api.post<{
        state: NonNullable<DocumentInfo["workspaceOcr"]>["state"];
        canRetry: boolean;
      }>(`/workspaces/${params.workspaceId}/documents/${params.id}/ocr`, {});
      setDocument((current) => current ? {
        ...current,
        status: result.state === "PENDING" || result.state === "PROCESSING"
          ? "OCR_PROCESSING"
          : current.status,
        workspaceOcr: {
          state: result.state,
          canStart: false,
          canRetry: result.canRetry,
        },
      } : current);
      setOcrConfirming(false);
    } catch (cause) {
      setOcrActionError(workspaceOcrError(cause));
    } finally {
      setOcrSubmitting(false);
    }
  }
  useEffect(() => {
    if (!initialQuery) return;
    // Search the opened document for a query supplied in its URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void findMatches();
  }, [findMatches, initialQuery]);

  const current = matches?.matches[active];
  return (
    <>
      <nav aria-label="Ruta del documento">
        <Link href={backHref}>← Volver a los documentos</Link>
        <span>
          › {workspaceName ?? "Documentos de la dependencia"} ›
          {document?.file?.filename ?? "Documento"}
        </span>
      </nav>
      <PageHeader
        title={document?.title ?? "Documento"}
        description={
          document?.file?.filename ??
          `Documento compartido con ${workspaceName ?? "tu dependencia"}`
        }
      />
      {error ? (
        <p className={styles.viewerError} role="alert">{error}</p>
      ) : (
        <>
      {document?.status === "OCR_PROCESSING" && !document.workspaceOcr && (
        <Card>
          <p>Procesando documento… La búsqueda se actualizará cuando termine.</p>
        </Card>
      )}
      {document?.status === "OCR_REQUIRED" && !document.workspaceOcr && (
        <Card>
          <p role="status">
            El PDF original está disponible. Todavía no hay texto para buscar.
          </p>
        </Card>
      )}
      {document?.status === "OCR_FAILED" && !document.workspaceOcr && (
        <Card>
          <p>No pudimos extraer el texto de este archivo.</p>
        </Card>
      )}
      {document?.workspaceOcr && document.workspaceOcr.state !== "NOT_REQUIRED" && (
        <Card>
          <section className={styles.workspaceOcrPanel} aria-label="Reconocimiento de texto del documento">
            {document.workspaceOcr.state === "NEEDS_OCR" && (
              <>
                <p role="status">El PDF original está disponible, pero todavía no hay texto para buscar dentro de él.</p>
                {document.workspaceOcr.canStart ? (
                  ocrConfirming ? (
                    <div className={styles.workspaceOcrConfirm} role="group" aria-label="Confirmar reconocimiento de texto">
                      <strong>Reconocer texto</strong>
                      <p>Galilei analizará este PDF para permitir búsquedas dentro de esta dependencia. El archivo original no será modificado.</p>
                      <div>
                        <button type="button" className={styles.workspaceOcrCancel} disabled={ocrSubmitting} onClick={() => setOcrConfirming(false)}>Cancelar</button>
                        <button type="button" className={styles.workspaceOcrButton} disabled={ocrSubmitting} onClick={() => void startWorkspaceOcr()}>
                          {ocrSubmitting ? "Iniciando OCR…" : "Iniciar OCR"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={styles.workspaceOcrButton} onClick={() => { setOcrActionError(""); setOcrConfirming(true); }}>
                      Reconocer texto (OCR)
                    </button>
                  )
                ) : (
                  <p>Un editor o administrador de la dependencia puede iniciar el reconocimiento.</p>
                )}
              </>
            )}
            {(document.workspaceOcr.state === "PENDING" || document.workspaceOcr.state === "PROCESSING") && (
              <p className={styles.workspaceOcrStatus} role="status">
                {document.workspaceOcr.state === "PENDING" ? "OCR pendiente. El estado se actualizará automáticamente." : "Reconociendo texto…"}
              </p>
            )}
            {document.workspaceOcr.state === "COMPLETED" && (
              <p className={styles.workspaceOcrComplete} role="status">Texto reconocido. Listo para buscar dentro de este documento.</p>
            )}
            {document.workspaceOcr.state === "ERROR" && (
              <>
                <p className={styles.workspaceOcrError} role="status">No se pudo reconocer el texto. El PDF original sigue disponible.</p>
                {document.workspaceOcr.canStart && (
                  ocrConfirming ? (
                    <div className={styles.workspaceOcrConfirm} role="group" aria-label="Confirmar reintento de reconocimiento">
                      <strong>Reintentar reconocimiento</strong>
                      <p>Galilei volverá a analizar el PDF original, que permanecerá intacto.</p>
                      <div>
                        <button type="button" className={styles.workspaceOcrCancel} disabled={ocrSubmitting} onClick={() => setOcrConfirming(false)}>Cancelar</button>
                        <button type="button" className={styles.workspaceOcrButton} disabled={ocrSubmitting} onClick={() => void startWorkspaceOcr()}>
                          {ocrSubmitting ? "Iniciando OCR…" : "Iniciar OCR"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={styles.workspaceOcrButton} onClick={() => { setOcrActionError(""); setOcrConfirming(true); }}>Reintentar OCR</button>
                  )
                )}
              </>
            )}
            {ocrActionError && <p className={styles.workspaceOcrError} role="alert">{ocrActionError}</p>}
          </section>
        </Card>
      )}
      <Card>
        <form className={styles.workspaceViewerSearch}
          onSubmit={(event) => {
            event.preventDefault();
            void findMatches();
          }}
        >
          <Input
            label="Buscar en el documento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={document?.status === "OCR_REQUIRED" ? "El texto todavía no está disponible" : "Buscar y resaltar en el documento"}
            disabled={document?.status === "OCR_REQUIRED"}
          />
          <Button type="submit" disabled={document?.status === "OCR_REQUIRED"}>Buscar</Button>
        </form>
        {matches && (
          <p>
            {matches.total} coincidencias
            {matches.truncated ? ` (mostrando ${matches.returned} primeras; total exacto desconocido)` : ""}{" "}
            {current && `· página ${current.page}`}
          </p>
        )}
        {matches?.matches.length ? (
          <div className={styles.workspaceMatchToolbar}>
            <Button variant="secondary"
              onClick={() => {
                const next =
                  (active + matches.matches.length - 1) %
                  matches.matches.length;
                setActive(next);
                setPage(matches.matches[next].page);
              }}
            >
              Anterior
            </Button>
            <Button variant="secondary"
              onClick={() => {
                const next = (active + 1) % matches.matches.length;
                setActive(next);
                setPage(matches.matches[next].page);
              }}
            >
              Siguiente
            </Button>
            <span>{current?.context}</span>
          </div>
        ) : null}
      </Card>
      <Card>
        <div className={styles.workspaceViewerToolbar} aria-label="Controles del visor">
          {isPdf && document?.status !== "OCR_REQUIRED" && (<Button variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Página anterior
          </Button>)}
          <span>
            {isPdf && document?.status === "OCR_REQUIRED"
              ? "PDF original · navegación del visor"
              : isPdf
                ? "Página " + page + " de " + (effectivePageCount || "?")
                : "Texto extraído"}
          </span>
          {isPdf && document?.status !== "OCR_REQUIRED" && (<Button variant="secondary"
            disabled={!!effectivePageCount && page >= effectivePageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Página siguiente
          </Button>)}
          <Button variant="secondary" onClick={() => void downloadPdf()}>
            Descargar {fileTypeLabel(document?.file?.mimeType)}
          </Button>
        </div>
        {document?.file && !isPdf ? (
          <pre className={styles.textPreview} aria-label="Texto extraído del documento">
            {renderTextMatch(
              document.selectedPage?.text ?? "",
              matches?.matches ?? [],
              page,
              current?.ordinal,
            )}
          </pre>
        ) : pdf ? (
          <>
          {document?.selectedPage?.textKind === 'OCR' && (
            <p role="status">Texto reconocido automáticamente. La navegación está disponible; el resaltado visual no está disponible para texto reconocido.</p>
          )}
          {isPdf && document?.status === "OCR_REQUIRED" ? (
            <iframe
              className={styles.workspacePdfNativeViewer}
              title={`PDF original: ${document.file?.filename ?? document.title}`}
              src={pdf}
            />
          ) : (
            <CorpusPdfViewer
              file={pdf}
              page={page}
              matches={matches?.matches ?? []}
              activeMatch={active}
              onLoadSuccess={setPageCount}
              structurePath={`/workspaces/${params.workspaceId}/documents/${params.id}/structure`}
              onGoToPage={setPage}
            />
          )}
          </>
        ) : (
          <p>Cargando documento…</p>
        )}
      </Card>
        </>
      )}
    </>
  );
}
