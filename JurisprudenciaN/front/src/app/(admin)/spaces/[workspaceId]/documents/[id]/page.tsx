"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { downloadBlob } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
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
      return "El espacio o documento ya no está disponible para tu cuenta.";
    if (cause.status >= 500)
      return "Ocurrió un problema al abrir el documento. Podés volver a intentarlo.";
  }
  return fallback;
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
  const [page, setPage] = useState(
    Math.max(1, Number(searchParams.get("page") ?? 1)),
  );
  const [pageCount, setPageCount] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const effectivePageCount =
    pageCount || document?.extraction?.pageCount || document?.file?.pageCount || 0;
  const isPdf = document?.file?.mimeType === "application/pdf";

  useEffect(() => {
    let alive = true;
    void api.get<DocumentInfo>(
      `/workspaces/${params.workspaceId}/documents/${params.id}`,
      { query: { pageNumber: page } },
    )
      .then((info) => {
        if (alive) setDocument(info);
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(viewerError(cause, "No se pudo abrir el documento privado."));
      });
    return () => {
      alive = false;
    };
  }, [params.workspaceId, params.id, page]);

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
          setError(viewerError(cause, "No se pudo abrir el documento privado."));
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
      setError(viewerError(cause, "No se pudo descargar el documento privado."));
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
        <Link href={backHref}>← Volver al espacio</Link>
        <span>
          　›　{workspaceName ?? "Espacio documental"}　›　
          {document?.file?.filename ?? "Documento"}
        </span>
      </nav>
      <PageHeader
        title={document?.title ?? "Documento privado"}
        description={
          document?.file?.filename ??
          "Visor con acceso controlado por workspace"
        }
      />
      {error && (
        <p role="alert" style={{ color: "#b42318" }}>
          {error}
        </p>
      )}
      {document?.status === "OCR_PROCESSING" && (
        <Card>
          <p>Reconociendo texto… La búsqueda y la navegación se actualizarán al terminar.</p>
        </Card>
      )}
      {document?.status === "OCR_REQUIRED" && (
        <Card>
          <p>El texto escaneado quedó pendiente de procesamiento.</p>
        </Card>
      )}
      {document?.status === "OCR_FAILED" && (
        <Card>
          <p>No pudimos reconocer el texto de este documento.</p>
        </Card>
      )}
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void findMatches();
          }}
        >
          <input
            aria-label="Buscar en el documento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar y resaltar en el documento"
          />
          <button>Buscar</button>
        </form>
        {matches && (
          <p>
            {matches.total} coincidencias
            {matches.truncated ? ` (mostrando ${matches.returned} primeras; total exacto desconocido)` : ""}{" "}
            {current && `· página ${current.page}`}
          </p>
        )}
        {matches?.matches.length ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => {
                const next =
                  (active + matches.matches.length - 1) %
                  matches.matches.length;
                setActive(next);
                setPage(matches.matches[next].page);
              }}
            >
              Anterior
            </button>
            <button
              onClick={() => {
                const next = (active + 1) % matches.matches.length;
                setActive(next);
                setPage(matches.matches[next].page);
              }}
            >
              Siguiente
            </button>
            <span>{current?.context}</span>
          </div>
        ) : null}
      </Card>
      <Card>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          {isPdf && (<button
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Página anterior
          </button>)}
          <span>
            {isPdf ? "Página " + page + " de " + (effectivePageCount || "?") : "Texto extraído"}
          </span>
          {isPdf && (<button
            disabled={!!effectivePageCount && page >= effectivePageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Página siguiente
          </button>)}
          <button onClick={() => void downloadPdf()}>
            Descargar {fileTypeLabel(document?.file?.mimeType)}
          </button>
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
            <p role="status">Texto reconocido por OCR. La navegación y el contexto están disponibles; no se dibujan resaltados visuales de OCR.</p>
          )}
          <CorpusPdfViewer
            file={pdf}
            page={page}
            matches={matches?.matches ?? []}
            activeMatch={active}
            onLoadSuccess={setPageCount}
          />
          </>
        ) : (
          <p>Cargando documento…</p>
        )}
      </Card>
    </>
  );
}
