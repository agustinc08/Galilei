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

const CorpusPdfViewer = dynamic(
  () =>
    import("@/app/(admin)/corpus/[id]/CorpusPdfViewer").then(
      (module) => module.CorpusPdfViewer,
    ),
  { ssr: false, loading: () => <p>Cargando PDF…</p> },
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
};
type Matches = {
  total: number;
  truncated: boolean;
  matches: Array<PdfMatch & { context: string; total: number }>;
};

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
  for (const key of ["workspaceId", "folderId", "q", "searchFolderMode"]) {
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

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void Promise.all([
      api.get<DocumentInfo>(
        `/workspaces/${params.workspaceId}/documents/${params.id}`,
      ),
      api.download(
        `/workspaces/${params.workspaceId}/documents/${params.id}/file`,
      ),
    ])
      .then(([info, blob]) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setDocument(info);
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
      setActive(0);
      if (data.matches[0]) setPage(data.matches[0].page);
    } catch (cause) {
      setError(viewerError(cause, "No se pudo buscar dentro del documento."));
    }
  }, [params.id, params.workspaceId, query]);
  async function downloadPdf() {
    try {
      const blob = await api.download(
        `/workspaces/${params.workspaceId}/documents/${params.id}/file?download=true`,
      );
      downloadBlob(blob, document?.file?.filename ?? "documento.pdf");
    } catch (cause) {
      setError(viewerError(cause, "No se pudo descargar el PDF privado."));
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
      {document?.status === "OCR_REQUIRED" && (
        <Card>
          <p>
            El PDF está disponible para lectura. No se incluyó en búsqueda
            porque requiere OCR.
          </p>
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
            placeholder="Buscar y resaltar en el PDF"
          />
          <button>Buscar</button>
        </form>
        {matches && (
          <p>
            {matches.total} coincidencias
            {matches.truncated ? " (muestra truncada)" : ""}{" "}
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
          <button
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Página anterior
          </button>
          <span>
            Página {page} de{" "}
            {pageCount || document?.extraction?.pageCount || "?"}
          </span>
          <button
            disabled={!!pageCount && page >= pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Página siguiente
          </button>
          <button onClick={() => void downloadPdf()}>Descargar PDF</button>
        </div>
        {pdf ? (
          <CorpusPdfViewer
            file={pdf}
            page={page}
            matches={matches?.matches ?? []}
            activeMatch={active}
            onLoadSuccess={setPageCount}
          />
        ) : (
          <p>Cargando PDF…</p>
        )}
      </Card>
    </>
  );
}
