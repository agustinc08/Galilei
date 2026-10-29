"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import dynamic from "@/lib/router-compat"
import { Link } from "@/lib/router-compat";
import { useRouter, useSearchParams } from "@/lib/router-compat";
import { api, ApiError } from "@/lib/api";
import { normalizeWorkspaceListResponse } from "@/lib/workspace-list-response";
import { useAuth } from "@/hooks/use-auth";
import { downloadBlob } from "@/lib/utils";
import type { PdfMatch } from "@/app/(admin)/corpus/[id]/CorpusPdfViewer";
import styles from "./copernic-search.module.css";

const CorpusPdfViewer = dynamic(
  () =>
    import("@/app/(admin)/corpus/[id]/CorpusPdfViewer").then(
      (module) => module.CorpusPdfViewer,
    ),
  { ssr: false, loading: () => <p className={styles.previewMessage}>Cargando visor documental…</p> },
);

type WorkspaceRole = "ADMIN" | "EDITOR" | "VIEWER";
type Workspace = {
  id: string;
  name: string;
  code: string;
  type: string;
  role: WorkspaceRole;
};
type Folder = {
  id: string;
  parentId: string | null;
  name: string;
  _count: { documents: number; children: number };
};
type SearchSource = {
  id: string;
  name: string;
  type: string;
  status: string;
  enabled: boolean;
  fileCount: number;
};
type SourceFolder = {
  path: string;
  parentPath: string | null;
  name: string;
  fileCount: number;
};
type CorpusSearchResult = {
  id: string;
  sourceId: string;
  title: string | null;
  date: string | null;
  snippet: string | null;
  document: { mimeType: string | null } | null;
  metadata: Record<string, string | number | boolean | null>;
};
type SearchPage = {
  total: number;
  totalExact?: boolean;
  hasMore?: boolean;
  partial?: boolean;
  page: number;
  pageSize: number;
  results: CorpusSearchResult[];
};
type NameSearchPage = {
  total: number;
  totalExact: boolean;
  page: number;
  pageSize: number;
  results: Array<{
    documentId: string;
    title: string;
    filename: string;
    mimeType: string | null;
    status: string;
    uploadedAt: string;
    folder: { id: string; name: string } | null;
  }>;
};
type WorkspaceDocumentListPage = {
  page: number;
  pageSize: number;
  total: number;
  results: Array<{
    createdAt: string;
    folder: { id: string; name: string } | null;
    document: {
      id: string;
      title: string;
      status: string;
      file: { filename: string; mimeType: string } | null;
    };
  }>;
};
type SearchHit = {
  documentId: string;
  filename: string;
  fileType: "PDF" | "TXT" | "RTF" | "DOC" | "DOCX" | "ODT" | "OTRO";
  title: string;
  page: number;
  folderId: string | null;
  folderName: string;
  uploadedAt: string | null;
  sourceName: string | null;
  sourceFolder: string | null;
  sourceStatus: string | null;
  documentStatus: string | null;
  snippet: string | null;
  kind: "CONTENIDO" | "NOMBRE" | "LIST";
};
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
type DocumentMatches = {
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
type PreviewState = {
  document: DocumentInfo;
  fileUrl: string;
  matches: DocumentMatches;
};

function renderTextPreview(
  text: string,
  matches: DocumentMatches["matches"],
  activeOrdinal: number,
) {
  const ranges = matches
    .filter((match) => match.page === 1 && match.end > match.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const match of ranges) {
    const start = Math.max(cursor, match.start);
    const end = Math.min(text.length, match.end);
    if (end <= start) continue;
    if (start > cursor) segments.push(text.slice(cursor, start));
    segments.push(
      <mark className={match.ordinal === activeOrdinal ? "bjc-text-match-current" : "bjc-text-match"} key={`${match.ordinal}-${start}-${end}`}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments;
}

const MANUAL_SOURCE_ID = "__manual_upload__";
const EMPTY_MATCHES: DocumentMatches = {
  total: 0,
  returned: 0,
  exactTotalKnown: true,
  truncated: false,
  matches: [],
};

type DatePreset = "any" | "7d" | "30d" | "1y" | "custom";

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetDateRange(preset: Exclude<DatePreset, "any" | "custom">) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (preset === "7d") start.setDate(start.getDate() - 6);
  else if (preset === "30d") start.setDate(start.getDate() - 29);
  else start.setFullYear(start.getFullYear() - 1);
  return { dateFrom: dateInputValue(start), dateTo: dateInputValue(end) };
}

function validDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const test = new Date(Date.UTC(year, month - 1, day));
  return test.getUTCFullYear() === year && test.getUTCMonth() === month - 1 && test.getUTCDate() === day;
}

function validateDateFilter(from: string, to: string) {
  if ((from && !validDateInput(from)) || (to && !validDateInput(to))) {
    return "Ingresá fechas válidas con formato calendario.";
  }
  if (from && to && from > to) return "La fecha desde no puede ser posterior a la fecha hasta.";
  return "";
}

function safeError(cause: unknown) {
  if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404))
    return "No encontramos este documento o no tenés acceso.";
  if (cause instanceof ApiError && cause.status === 401)
    return "Tu sesión venció. Volvé a ingresar.";
  return "No se pudo completar la búsqueda. Revisá tu conexión e intentá nuevamente.";
}

function formattedDate(value: string | null | undefined) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(date);
}

function folderName(folderId: string | null, folders: Folder[]) {
  if (!folderId) return "Todos los documentos";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  let current = byId.get(folderId);
  while (current && parts.length <= folders.length) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ") || "Todos los documentos";
}

function dependencyKindLabel(type: string) {
  if (type === "SALA") return "MI SALA";
  if (type === "JUZGADO") return "MI JUZGADO";
  if (type === "SECRETARIA") return "MI SECRETARÍA";
  return "MI DEPENDENCIA";
}

function fileTypeFromMime(mimeType: string | null): SearchHit["fileType"] {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "text/plain") return "TXT";
  if (mimeType === "application/rtf" || mimeType === "text/rtf") return "RTF";
  if (mimeType === "application/msword") return "DOC";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  if (mimeType === "application/vnd.oasis.opendocument.text") return "ODT";
  return "OTRO";
}
function documentStatusLabel(status: string | null) {
  if (status === "OCR_PROCESSING" || status === "OCR_REQUIRED") return "Procesando documento…";
  if (status === "OCR_FAILED" || status === "ERROR" || status === "INVALID_PDF")
    return "No pudimos procesar este archivo";
  if (status === "INDEXED") return "Listo para buscar";
  return "Documento compartido";
}

function positiveTerms(query: string) {
  const positiveQuery = query
    .replace(/(?:^|\s)-(?:"[^"]+"|[^\s]+)/gu, " ")
    .replace(/\bNOT\s+(?:"[^"]+"|[^\s]+)/giu, " ");
  return [...new Set(positiveQuery.match(/[\p{L}\p{N}]{2,}/gu) ?? [])]
    .filter((term) => !/^(AND|OR|NOT)$/iu.test(term))
    .sort((a, b) => b.length - a.length);
}

function highlightSnippet(snippet: string, query: string): ReactNode {
  const terms = positiveTerms(query);
  if (!terms.length) return snippet;
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
    "giu",
  );
  return snippet.split(expression).map((part, index) =>
    terms.some((term) => term.localeCompare(part, undefined, { sensitivity: "accent" }) === 0) ? (
      <mark className={styles.snippetMark} key={`${index}-${part}`}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function buildHitList(
  content: SearchPage | null,
  names: NameSearchPage | null,
): SearchHit[] {
  const hits = new Map<string, SearchHit>();
  for (const result of content?.results ?? []) {
    const metadata = result.metadata;
    const documentId = result.sourceId;
    hits.set(documentId, {
      documentId,
      filename: String(metadata.filename || result.title || "Documento"),
      fileType: fileTypeFromMime(result.document?.mimeType ?? null),
      title: result.title || String(metadata.filename || "Documento"),
      page: Math.max(1, Number(metadata.pageNumber || 1)),
      folderId: typeof metadata.folderId === "string" ? metadata.folderId : null,
      folderName: String(metadata.folderName || "Todos los documentos"),
      uploadedAt: typeof metadata.uploadedAt === "string" ? metadata.uploadedAt : null,
      sourceName: typeof metadata.sourceName === "string" ? metadata.sourceName : null,
      sourceFolder: typeof metadata.sourceFolder === "string" ? metadata.sourceFolder : null,
      sourceStatus: typeof metadata.sourceStatus === "string" ? metadata.sourceStatus : null,
      documentStatus: typeof metadata.status === "string" ? metadata.status : null,
      snippet: result.snippet,
      kind: "CONTENIDO",
    });
  }
  for (const result of names?.results ?? []) {
    if (hits.has(result.documentId)) continue;
    hits.set(result.documentId, {
      documentId: result.documentId,
      filename: result.filename,
      fileType: fileTypeFromMime(result.mimeType),
      title: result.title,
      page: 1,
      folderId: result.folder?.id ?? null,
      folderName: result.folder?.name ?? "Todos los documentos",
      uploadedAt: result.uploadedAt,
      sourceName: null,
      sourceFolder: null,
      sourceStatus: null,
      documentStatus: result.status,
      snippet: null,
      kind: "LIST",
    });
  }
  return [...hits.values()];
}

function buildWorkspaceDocumentHits(page: WorkspaceDocumentListPage | null): SearchHit[] {
  return (page?.results ?? []).map((row) => {
    const filename = row.document.file?.filename ?? row.document.title ?? "Documento";
    return {
      documentId: row.document.id,
      filename,
      fileType: fileTypeFromMime(row.document.file?.mimeType ?? null),
      title: row.document.title || filename,
      page: 1,
      folderId: row.folder?.id ?? null,
      folderName: row.folder?.name ?? "Todos los documentos",
      uploadedAt: row.createdAt,
      sourceName: "Carga manual",
      sourceFolder: null,
      sourceStatus: null,
      documentStatus: row.document.status,
      snippet: null,
      kind: "NOMBRE",
    };
  });
}

function displaySourceName(name: string | null) {
  return name === "Carga manual" ? "Documentos cargados" : name;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export function CopernicWorkspaceSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);
  const committedQuery = params.get("q") ?? "";
  const workspaceId = params.get("workspaceId") ?? "";
  const activeFolderId = params.get("folderId") ?? "";
  const activeSourceId = params.get("sourceId") ?? "";
  const activeSourceFolder = params.get("sourceFolder") ?? "";
  const activeType = params.get("type") ?? "";
  const activeDateFrom = params.get("dateFrom") ?? "";
  const activeDateTo = params.get("dateTo") ?? "";
  const activeDatePreset = (params.get("datePreset") as DatePreset | null)
    ?? (activeDateFrom || activeDateTo ? "custom" : "any");
  const dateFilterError = validateDateFilter(activeDateFrom, activeDateTo);
  const hasDateFilter = Boolean(activeDateFrom || activeDateTo);
  const pageNumber = Math.max(1, Number(params.get("page") || 1));
  const selectedId = params.get("selected") ?? "";
  const initialMatchOrdinal = Math.max(1, Number(params.get("match") || 1));
  const initialMatchOrdinalRef = useRef(initialMatchOrdinal);
  const selectedIdRef = useRef(selectedId);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceLoadError, setWorkspaceLoadError] = useState("");
  const [workspaceLoadAttempt, setWorkspaceLoadAttempt] = useState(0);
  const [workspaceChoiceId, setWorkspaceChoiceId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [sourceFolders, setSourceFolders] = useState<SourceFolder[]>([]);
  const [sourceFoldersLoading, setSourceFoldersLoading] = useState(false);
  const [draftQuery, setDraftQuery] = useState(committedQuery);
  const [searchPage, setSearchPage] = useState<SearchPage | null>(null);
  const [namePage, setNamePage] = useState<NameSearchPage | null>(null);
  const [workspaceListPage, setWorkspaceListPage] = useState<WorkspaceDocumentListPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [workspaceDataLoading, setWorkspaceDataLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageCount, setPreviewPageCount] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [resultsAnnouncement, setResultsAnnouncement] = useState("");
  const queryInputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);
  const searchController = useRef<AbortController | null>(null);
  const workspaceController = useRef<AbortController | null>(null);
  const sourceFoldersController = useRef<AbortController | null>(null);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const activeSource = sources.find((item) => item.id === activeSourceId);
  const activeFolder = folders.find((item) => item.id === activeFolderId);
  const isAuthorizedWorkspace = workspaces.some((item) => item.id === workspaceId);
  const searchHits = useMemo(() => buildHitList(searchPage, namePage), [searchPage, namePage]);
  const workspaceListHits = useMemo(() => buildWorkspaceDocumentHits(workspaceListPage), [workspaceListPage]);
  const showWorkspaceListing = Boolean(workspaceId && isAuthorizedWorkspace && !committedQuery.trim() && !activeSourceFolder && (!activeSourceId || activeSourceId === MANUAL_SOURCE_ID));
  const hits = showWorkspaceListing ? workspaceListHits : searchHits;
  const selectedHit = hits.find((hit) => hit.documentId === selectedId) ?? null;
  const selectedDocumentId = selectedHit?.documentId ?? "";
  const selectedPage = selectedHit?.page ?? 1;
  const showWorkspaceChooser = !workspaceLoading && workspaces.length > 1 && !isAuthorizedWorkspace;
  const folderTreeRows = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => {
        const fullName = folderName(folder.id, folders);
        return { folder, fullName, depth: fullName.split(" / ").length - 1 };
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName, "es"))
      .filter(({ folder }) => {
        let parentId = folder.parentId;
        while (parentId) {
          if (collapsedFolderIds.has(parentId)) return false;
          parentId = byId.get(parentId)?.parentId ?? null;
        }
        return true;
      });
  }, [collapsedFolderIds, folders]);

  useEffect(() => {
    initialMatchOrdinalRef.current = initialMatchOrdinal;
  }, [initialMatchOrdinal]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const navigate = useCallback(
    (changes: Record<string, string | number | null | undefined>, replace = false) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      const href = `/spaces${next.size ? `?${next.toString()}` : ""}`;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    // Keep the draft input aligned with browser back/forward navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftQuery(committedQuery);
  }, [committedQuery]);

  useEffect(() => {
    let live = true;
    void api
      .get<Workspace[]>("/workspaces/mine")
      .then((mine) => {
        if (!live) return;
        setWorkspaces(mine);
        const requestedId = new URLSearchParams(window.location.search).get("workspaceId");
        const requested = mine.find((item) => item.id === requestedId);
        const selected = requested ?? (mine.length === 1 ? mine[0] : undefined);
        setWorkspaceChoiceId(selected?.id ?? "");
        if (selected && selected.id !== requestedId) {
          navigate(
            {
              workspaceId: selected.id,
              folderId: null,
              sourceId: null,
              sourceFolder: null,
              selected: null,
              match: null,
              page: 1,
            },
            true,
          );
        } else if (!selected && requestedId) {
          navigate({ workspaceId: null, folderId: null, sourceId: null, sourceFolder: null, selected: null, match: null, page: 1 }, true);
        }
      })
      .catch((cause: unknown) => {
        if (live) {
          setWorkspaceLoadError("No pudimos cargar tus dependencias. Revisá tu conexión e intentá nuevamente.");
          setSearchError(safeError(cause));
        }
      })
      .finally(() => {
        if (live) setWorkspaceLoading(false);
      });
    return () => {
      live = false;
    };
  }, [navigate, workspaceLoadAttempt]);

  useEffect(() => {
    if (!workspaceId || !isAuthorizedWorkspace) return;
    const controller = new AbortController();
    workspaceController.current?.abort();
    workspaceController.current = controller;
    // Clear the previous authorized scope before showing the next workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceDataLoading(true);
    setFolders([]);
    setSources([]);
    setSourceFolders([]);
    void Promise.all([
      api.get<Folder[]>(`/workspaces/${workspaceId}/folders`, {
        signal: controller.signal,
      }),
      api.get<SearchSource[]>(`/workspaces/${workspaceId}/search/sources`, {
        signal: controller.signal,
      }),
    ])
      .then(([nextFolders, nextSources]) => {
        if (controller.signal.aborted) return;
        setFolders(nextFolders);
        setSources(nextSources);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setSearchError(safeError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceDataLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId, isAuthorizedWorkspace]);

  useEffect(() => {
    sourceFoldersController.current?.abort();
    // Hide the previous source tree while the new source loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceFolders([]);
    if (!workspaceId || !activeSourceId || activeSourceId === MANUAL_SOURCE_ID) {
      setSourceFoldersLoading(false);
      return;
    }
    const controller = new AbortController();
    sourceFoldersController.current = controller;
    setSourceFoldersLoading(true);
    void api
      .get<{ folders: SourceFolder[] }>(
        `/workspaces/${workspaceId}/search/sources/${encodeURIComponent(activeSourceId)}/folders`,
        { signal: controller.signal },
      )
      .then((data) => {
        if (!controller.signal.aborted) setSourceFolders(data.folders);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setMessage(safeError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSourceFoldersLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId, activeSourceId]);

  useEffect(() => {
    searchController.current?.abort();
    if (!workspaceId || !isAuthorizedWorkspace) {
      // Remove prior results immediately when the URL loses its search scope.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchPage(null);
      setNamePage(null);
      setWorkspaceListPage(null);
      setSearching(false);
      return;
    }
    if (dateFilterError) {
      setSearchPage(null);
      setNamePage(null);
      setWorkspaceListPage(null);
      setSearching(false);
      setSearchError(dateFilterError);
      return;
    }
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setSearchError("");
    setMessage("");
    if (!committedQuery.trim()) {
      setSearchPage(null);
      setNamePage(null);
      if (!showWorkspaceListing) {
        setWorkspaceListPage(null);
        setSearching(false);
        return () => controller.abort();
      }
      setWorkspaceListPage(null);
      const listScopeQuery = {
        folderId: activeFolderId || undefined,
        page: pageNumber,
        pageSize: 20,
        type: activeType || undefined,
        dateFrom: activeDateFrom || undefined,
        dateTo: activeDateTo || undefined,
      };
      void api.get<WorkspaceDocumentListPage | WorkspaceDocumentListPage["results"]>(`/workspaces/${workspaceId}/documents`, {
        query: listScopeQuery,
        signal: controller.signal,
      })
        .then((response) => {
          if (controller.signal.aborted) return;
          const listing = normalizeWorkspaceListResponse(response, 20);
          setWorkspaceListPage(listing);
          setResultsAnnouncement(`${listing.total} documentos disponibles en la dependencia.`);
          if (Array.isArray(response) && pageNumber > 1) navigate({ page: null }, true);
          if (selectedIdRef.current && !listing.results.some((row) => row.document.id === selectedIdRef.current)) {
            navigate({ selected: null, match: null }, true);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setWorkspaceListPage(null);
            setSearchError(safeError(cause));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
      return () => controller.abort();
    }
    setWorkspaceListPage(null);
    const folderScope = activeFolderId || undefined;
    const scopeQuery = {
      folderId: folderScope,
      sourceId: activeSourceId || undefined,
      sourceFolder: activeSourceFolder || undefined,
      type: activeType || undefined,
      dateFrom: activeDateFrom || undefined,
      dateTo: activeDateTo || undefined,
    };
    void Promise.all([
      api.get<SearchPage>(`/workspaces/${workspaceId}/search`, {
        query: {
          q: committedQuery,
          page: pageNumber,
          pageSize: 20,
          ...scopeQuery,
        },
        signal: controller.signal,
      }),
      committedQuery.trim().length >= 2
        ? api.get<NameSearchPage>(`/workspaces/${workspaceId}/search/names`, {
            query: {
              q: committedQuery,
              page: pageNumber,
              pageSize: 20,
              ...scopeQuery,
            },
            signal: controller.signal,
          })
        : Promise.resolve(null),
    ])
      .then(([content, names]) => {
        if (controller.signal.aborted) return;
        setSearchPage(content);
        setNamePage(names);
        setResultsAnnouncement(
          `${content.totalExact === false ? `Más de ${content.total}` : content.total} resultados de contenido${names?.total ? ` y ${names.total} por nombre` : ""}.`,
        );
        if (selectedIdRef.current && ![...content.results.map((row) => row.sourceId), ...(names?.results.map((row) => row.documentId) ?? [])].includes(selectedIdRef.current)) {
          navigate({ selected: null, match: null }, true);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setSearchPage(null);
          setNamePage(null);
          setSearchError(safeError(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [
    workspaceId,
    isAuthorizedWorkspace,
    committedQuery,
    pageNumber,
    activeFolderId,
    activeSourceId,
    activeSourceFolder,
    activeType,
    activeDateFrom,
    activeDateTo,
    dateFilterError,
    showWorkspaceListing,
    navigate,
  ]);

  useEffect(() => {
    if (!workspaceId || !selectedDocumentId) {
      // Keep the preview aligned with the result selected in the URL.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError("");
      setPreviewPage(1);
      setSelectedMatchIndex(0);
      return;
    }
    const controller = new AbortController();
    // Clear the old PDF before loading the selected document.
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(true);
    setPreviewPage(selectedPage);
    setPreviewPageCount(0);
    setSelectedMatchIndex(0);
    let fileUrl: string | null = null;
    const matchRequest = committedQuery.trim()
      ? api.get<DocumentMatches>(
          `/workspaces/${workspaceId}/documents/${selectedDocumentId}/matches`,
          { query: { q: committedQuery }, signal: controller.signal },
        )
      : Promise.resolve(EMPTY_MATCHES);
    void Promise.all([
      api.get<DocumentInfo>(
        `/workspaces/${workspaceId}/documents/${selectedDocumentId}`,
        { query: { pageNumber: selectedPage }, signal: controller.signal },
      ),
      api.download(
        `/workspaces/${workspaceId}/documents/${selectedDocumentId}/file`,
        { signal: controller.signal },
      ),
      matchRequest,
    ])
      .then(([document, blob, matches]) => {
        if (controller.signal.aborted) return;
        fileUrl = URL.createObjectURL(blob);
        const requestedMatchIndex = matches.matches.findIndex(
          (match) => match.ordinal === initialMatchOrdinalRef.current,
        );
        const preferredMatchIndex = requestedMatchIndex >= 0 ? requestedMatchIndex : 0;
        const preferredMatch = matches.matches[preferredMatchIndex];
        setPreview({ document, fileUrl, matches });
        setSelectedMatchIndex(preferredMatchIndex);
        setPreviewPage(preferredMatch?.page ?? selectedPage);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setPreviewError(safeError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => {
      controller.abort();
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [workspaceId, selectedDocumentId, selectedPage, committedQuery]);

  const setSelection = useCallback(
    (documentId: string | null, matchOrdinal?: number) => {
      initialMatchOrdinalRef.current = matchOrdinal ?? 1;
      navigate(
        {
          selected: documentId,
          match: documentId && matchOrdinal ? matchOrdinal : null,
        },
        true,
      );
    },
    [navigate],
  );

  const commitSearch = useCallback(
    (event?: React.FormEvent<HTMLFormElement>, nextPage = 1) => {
      event?.preventDefault();
      const q = (queryInputRef.current?.value ?? draftQuery).trim();
      if (!q || !workspaceId) return;
      navigate({ q, page: nextPage, selected: null, match: null });
    },
    [draftQuery, navigate, workspaceId],
  );

  const selectWorkspace = (nextWorkspaceId: string) => {
    setWorkspaceChoiceId(nextWorkspaceId);
    navigate({
      workspaceId: nextWorkspaceId,
      folderId: null,
      sourceId: null,
      sourceFolder: null,
      page: 1,
      selected: null,
      match: null,
    });
  };

  const selectFolder = (nextFolderId: string | null) => {
    navigate({
      folderId: nextFolderId,
      sourceId: null,
      sourceFolder: null,
      page: 1,
      selected: null,
      match: null,
    });
  };

  const selectSource = (nextSourceId: string | null) => {
    navigate({
      sourceId: nextSourceId,
      sourceFolder: null,
      folderId: null,
      page: 1,
      selected: null,
      match: null,
    });
  };

  const selectSourceFolder = (path: string) => {
    navigate({
      sourceFolder: path,
      folderId: null,
      page: 1,
      selected: null,
      match: null,
    });
  };

  const clearFilters = () =>
    navigate({
      folderId: null,
      sourceId: null,
      sourceFolder: null,
      type: null,
      datePreset: null,
      dateFrom: null,
      dateTo: null,
      page: 1,
      selected: null,
      match: null,
    });

  const selectType = (type: string) =>
    navigate({ type: type || null, page: 1, selected: null, match: null }, true);

  const selectDatePreset = (preset: DatePreset) => {
    if (preset === "any") {
      navigate({ datePreset: null, dateFrom: null, dateTo: null, page: 1, selected: null, match: null }, true);
      return;
    }
    if (preset === "custom") {
      navigate({ datePreset: preset, page: 1, selected: null, match: null }, true);
      return;
    }
    navigate({ datePreset: preset, ...presetDateRange(preset), page: 1, selected: null, match: null }, true);
  };

  const setCustomDate = (key: "dateFrom" | "dateTo", value: string) =>
    navigate({ datePreset: "custom", [key]: value || null, page: 1, selected: null, match: null }, true);

  const dateFilterLabel = activeDatePreset === "7d"
    ? "Últimos 7 días"
    : activeDatePreset === "30d"
      ? "Últimos 30 días"
      : activeDatePreset === "1y"
        ? "Último año"
        : activeDateFrom && activeDateTo
          ? `${activeDateFrom} – ${activeDateTo}`
          : activeDateFrom
            ? `Desde ${activeDateFrom}`
            : activeDateTo
              ? `Hasta ${activeDateTo}`
              : "Fecha personalizada";

  const openFullViewer = (hit: SearchHit) => {
    const query = new URLSearchParams({
      workspaceId,
      q: committedQuery,
      page: String(previewPage || hit.page),
      workspaceName: workspace?.name ?? "",
      folderId: activeFolderId,
      searchFolderMode: "CURRENT",
      searchPage: String(pageNumber),
      selected: hit.documentId,
      match: String(selectedMatchIndex + 1),
      ...(activeSourceId ? { sourceId: activeSourceId } : {}),
      ...(activeSourceFolder ? { sourceFolder: activeSourceFolder } : {}),
        ...(activeType ? { type: activeType } : {}),
        ...(activeDatePreset !== "any" ? { datePreset: activeDatePreset } : {}),
        ...(activeDateFrom ? { dateFrom: activeDateFrom } : {}),
        ...(activeDateTo ? { dateTo: activeDateTo } : {}),
    });
    router.push(
      `/spaces/${workspaceId}/documents/${hit.documentId}?${query.toString()}`,
    );
  };

  const navigateMatch = useCallback(
    (direction: 1 | -1) => {
      if (!preview?.matches.matches.length || !selectedHit) return;
      const length = preview.matches.matches.length;
      const nextIndex = (selectedMatchIndex + direction + length) % length;
      const nextMatch = preview.matches.matches[nextIndex];
      const wrapped = direction > 0
        ? selectedMatchIndex === length - 1
        : selectedMatchIndex === 0;
      setSelectedMatchIndex(nextIndex);
      setPreviewPage(nextMatch.page);
      navigate({ match: nextMatch.ordinal }, true);
      setResultsAnnouncement(
        `${wrapped ? direction > 0 ? "Fin de la muestra; volvemos al inicio. " : "Inicio de la muestra; volvemos al final. " : ""}Coincidencia ${nextMatch.ordinal} de ${preview.matches.total}${preview.matches.truncated ? " o más" : ""}, página ${nextMatch.page}.`,
      );
    },
    [navigate, preview, selectedHit, selectedMatchIndex],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        queryInputRef.current?.focus();
        queryInputRef.current?.select();
        return;
      }
      if (event.key === "Escape") {
        if (selectedId) {
          event.preventDefault();
          setSelection(null);
        }
        return;
      }
      if ((event.key === "F3") && !isEditableTarget(event.target)) {
        if (preview?.matches.matches.length) {
          event.preventDefault();
          navigateMatch(event.shiftKey ? -1 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateMatch, preview, selectedId, setSelection]);

  const onResultsKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!hits.length) return;
    event.preventDefault();
    const buttons = Array.from(
      resultsListRef.current?.querySelectorAll<HTMLButtonElement>(".resultSelect") ?? [],
    );
    const selectedIndex = hits.findIndex((hit) => hit.documentId === selectedId);
    const focusedIndex = buttons.indexOf(event.currentTarget);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(hits.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
    setSelection(hits[nextIndex].documentId);
    buttons[nextIndex]?.focus();
  };

  const fullViewerHref = selectedHit
    ? `/spaces/${workspaceId}/documents/${selectedHit.documentId}?${new URLSearchParams({
        workspaceId,
        q: committedQuery,
        page: String(previewPage || selectedHit.page),
        workspaceName: workspace?.name ?? "",
        folderId: activeFolderId,
        searchFolderMode: "CURRENT",
        searchPage: String(pageNumber),
        selected: selectedHit.documentId,
        match: String(selectedMatchIndex + 1),
        ...(activeSourceId ? { sourceId: activeSourceId } : {}),
        ...(activeSourceFolder ? { sourceFolder: activeSourceFolder } : {}),
        ...(activeType ? { type: activeType } : {}),
        ...(activeDatePreset !== "any" ? { datePreset: activeDatePreset } : {}),
        ...(activeDateFrom ? { dateFrom: activeDateFrom } : {}),
        ...(activeDateTo ? { dateTo: activeDateTo } : {}),
      }).toString()}`
    : "#";

  async function downloadSelected() {
    if (!workspaceId || !selectedHit) return;
    try {
      const blob = await api.download(
        `/workspaces/${workspaceId}/documents/${selectedHit.documentId}/file?download=true`,
      );
      downloadBlob(blob, preview?.document.file?.filename ?? selectedHit.filename);
    } catch (cause) {
      setPreviewError(safeError(cause));
    }
  }

  async function copyValue(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setMessage("El navegador no permitió copiar al portapapeles.");
    }
  }

  const activeScope = activeSource
    ? `${displaySourceName(activeSource.name)}${activeSourceFolder ? ` / ${activeSourceFolder.replaceAll("\\", " / ")}` : ""}`
    : activeFolder
      ? `${folderName(activeFolderId, folders)} · ${workspace?.name ?? ""}`
      : `Documentos compartidos con ${workspace?.name ?? "tu dependencia"}`;
  const offlineSource = activeSource && ["OFFLINE", "ACCESS_DENIED"].includes(activeSource.status);
  const contentTotal = searchPage
    ? searchPage.totalExact === false
      ? `Más de ${searchPage.total}`
      : String(searchPage.total)
    : "0";

  return (
    <section className={`${styles.shell} ${showWorkspaceChooser ? styles.chooserShell : ""}`} aria-label={`Documentos de ${workspace?.name ?? "la dependencia"}`}>
      <header className={styles.shellHeader}>
        <div className={styles.productTitle}>
          <span className={styles.productMark} aria-hidden="true">G</span>
          <div>
            <p className={styles.eyebrow}>{workspace ? dependencyKindLabel(workspace.type) : "GALILEI · DOCUMENTOS"}</p>
            <h1 title={workspace?.name}>{workspace?.name ?? "Buscar documentos"}</h1>
          </div>
        </div>
        <div className={styles.headerActions}>
          {workspaces.length > 1 && isAuthorizedWorkspace && (
            <label className={styles.workspaceSelectLabel}>
              <span>Dependencia</span>
              <select
                aria-label="Cambiar dependencia"
                value={workspaceId}
                onChange={(event) => selectWorkspace(event.target.value)}
                disabled={workspaceLoading}
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {workspace && (workspace.role === "ADMIN" || workspace.role === "EDITOR") && (
            <Link
              className={styles.secondaryLink}
              href={`/spaces/manage?workspaceId=${encodeURIComponent(workspace.id)}`}
            >
              Administrar dependencia
            </Link>
          )}
        </div>
      </header>

      {workspaceLoading || (workspaces.length === 1 && !isAuthorizedWorkspace) ? (
        <div className={styles.loadingWorkspace} role="status">Cargando tus documentos…</div>
      ) : workspaceLoadError ? (
        <div className={styles.noWorkspace} role="alert">
          <h2>No pudimos cargar tus dependencias</h2>
          <p>Revisá tu conexión y volvé a intentarlo.</p>
          <button className={styles.primaryLink} type="button" onClick={() => {
            setWorkspaceLoading(true);
            setWorkspaceLoadError("");
            setSearchError("");
            setWorkspaceLoadAttempt((attempt) => attempt + 1);
          }}>
            Reintentar
          </button>
        </div>
      ) : workspaces.length === 0 ? (
        <div className={styles.noWorkspace}>
          <h2>Todavía no tenés una dependencia asignada</h2>
          <p>Cuando te den acceso, acá vas a encontrar los documentos de tu Sala o Juzgado.</p>
          {user?.rol.nombre === "ADMIN" && (
            <Link className={styles.primaryLink} href="/spaces/manage">Administrar dependencias</Link>
          )}
        </div>
      ) : showWorkspaceChooser ? (
        <div className={styles.workspaceChooser}>
          <p className={styles.eyebrow}>TUS DEPENDENCIAS</p>
          <h2>¿Dónde querés trabajar?</h2>
          <p>Elegí la Sala, el Juzgado o la Secretaría cuyos documentos querés consultar.</p>
          <label className={styles.chooserField}>
            <span>Sala, Juzgado o Secretaría</span>
            <select aria-label="Elegir dependencia" value={workspaceChoiceId} onChange={(event) => setWorkspaceChoiceId(event.target.value)}>
              <option value="">Seleccioná una dependencia</option>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button className={styles.primaryLink} type="button" disabled={!workspaceChoiceId} onClick={() => selectWorkspace(workspaceChoiceId)}>
            Entrar
          </button>
        </div>
      ) : (
        <div
          className={`${styles.panels} ${leftCollapsed ? styles.leftCollapsed : ""} ${previewCollapsed ? styles.previewCollapsed : ""}`}
        >
          <aside className={styles.leftPanel} aria-label={`Carpetas de ${workspace?.name ?? "la dependencia"}`}>
            <div className={styles.panelHeading}>
              <h2>{leftCollapsed ? "" : "Carpetas"}</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={leftCollapsed ? "Expandir panel izquierdo" : "Colapsar panel izquierdo"}
                onClick={() => setLeftCollapsed((value) => !value)}
              >
                {leftCollapsed ? "›" : "‹"}
              </button>
            </div>
            {!leftCollapsed && (
              <div className={styles.treeContent}>
                <div className={styles.scopeGroup}>
                  <p className={styles.treeLabel}>DOCUMENTOS COMPARTIDOS</p>
                  <button
                    type="button"
                    aria-pressed={!activeFolderId && !activeSourceId}
                    className={`${styles.treeItem} ${!activeFolderId && !activeSourceId ? styles.treeItemActive : ""}`}
                    onClick={() => selectFolder(null)}
                  >
                    <span aria-hidden="true">▣</span>
                    <span>{workspace?.name ?? "Todos los documentos"}</span>
                  </button>
                  <div className={styles.folderTree} role="tree" aria-label={`Carpetas de ${workspace?.name ?? "la dependencia"}`}>
                    {folderTreeRows.map(({ folder, fullName, depth }) => {
                      const hasChildren = folder._count.children > 0;
                      const expanded = !collapsedFolderIds.has(folder.id);
                      return (
                        <div className={styles.folderTreeRow} key={folder.id}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className={styles.folderDisclosure}
                              aria-label={`${expanded ? "Contraer" : "Expandir"} ${folder.name}`}
                              aria-expanded={expanded}
                              onClick={() => setCollapsedFolderIds((current) => {
                                const next = new Set(current);
                                if (next.has(folder.id)) next.delete(folder.id);
                                else next.add(folder.id);
                                return next;
                              })}
                            >
                              {expanded ? "▾" : "▸"}
                            </button>
                          ) : <span className={styles.folderDisclosurePlaceholder} aria-hidden="true" />}
                          <button
                            type="button"
                            role="treeitem"
                            aria-level={depth + 1}
                            aria-expanded={hasChildren ? expanded : undefined}
                            aria-selected={activeFolderId === folder.id}
                            className={`${styles.treeItem} ${activeFolderId === folder.id ? styles.treeItemActive : ""}`}
                            title={fullName}
                            onKeyDown={(event) => {
                              if (!hasChildren || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                              event.preventDefault();
                              setCollapsedFolderIds((current) => {
                                const next = new Set(current);
                                if (event.key === "ArrowLeft") next.add(folder.id);
                                else next.delete(folder.id);
                                return next;
                              });
                            }}
                            onClick={() => selectFolder(folder.id)}
                          >
                            <span aria-hidden="true">▣</span>
                            <span>{folder.name}</span>
                            <small>{folder._count.documents}</small>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.scopeGroup}>
                  <div className={styles.treeLabelRow}>
                    <p className={styles.treeLabel}>CARPETAS COMPARTIDAS</p>
                    {workspaceDataLoading && <span className={styles.miniSpinner} aria-label="Cargando carpetas compartidas" />}
                  </div>
                  {sources.filter((source) => source.id !== MANUAL_SOURCE_ID).map((source) => (
                    <div key={source.id} className={styles.sourceBranch}>
                      <button
                        type="button"
                        className={`${styles.treeItem} ${activeSourceId === source.id && !activeSourceFolder ? styles.treeItemActive : ""}`}
                        aria-pressed={activeSourceId === source.id && !activeSourceFolder}
                        onClick={() => selectSource(activeSourceId === source.id ? null : source.id)}
                      >
                        <span className={source.enabled ? styles.sourceDot : styles.sourceDotDisabled} aria-hidden="true">●</span>
                        <span className={styles.sourceName}>{source.name}</span>
                        <small>{source.fileCount}</small>
                      </button>
                      {activeSourceId === source.id && (
                        <>
                          {offlineSource && <p className={styles.sourceState}>La carpeta de origen no está disponible en este momento.</p>}
                          {sourceFoldersLoading ? (
                            <p className={styles.sourceState}>Cargando carpetas…</p>
                          ) : (
                            sourceFolders.map((folder) => (
                              <button
                                type="button"
                                key={folder.path}
                                className={`${styles.treeItem} ${styles.sourceFolderItem} ${activeSourceFolder === folder.path ? styles.treeItemActive : ""}`}
                                style={{ "--depth": folder.path.split("\\").length } as React.CSSProperties}
                                aria-pressed={activeSourceFolder === folder.path}
                                onClick={() => selectSourceFolder(folder.path)}
                              >
                                <span aria-hidden="true">▸</span>
                                <span>{folder.name}</span>
                                <small>{folder.fileCount}</small>
                              </button>
                            ))
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className={`${styles.treeItem} ${activeSourceId === MANUAL_SOURCE_ID ? styles.treeItemActive : ""}`}
                    aria-pressed={activeSourceId === MANUAL_SOURCE_ID}
                    onClick={() => selectSource(activeSourceId === MANUAL_SOURCE_ID ? null : MANUAL_SOURCE_ID)}
                  >
                    <span className={styles.sourceDot} aria-hidden="true">●</span>
                    <span>Documentos cargados</span>
                    <small>{sources.find((item) => item.id === MANUAL_SOURCE_ID)?.fileCount ?? 0}</small>
                  </button>
                </div>
                <p className={styles.scopePrivacy}>Mostramos los documentos compartidos con {workspace?.name ?? "tu dependencia"}.</p>
              </div>
            )}
          </aside>

          <main className={styles.centerPanel} aria-label="Búsqueda y resultados">
            <div className={styles.searchSticky}>
              <p className={styles.scopeLine}>
                <span>Buscando en</span>
                <strong>{activeScope}</strong>
              </p>
              <form
                className={styles.searchForm}
                role="search"
                onSubmit={(event) => commitSearch(event)}
              >
                <label className={styles.visuallyHidden} htmlFor="copernic-workspace-query">
                  Buscar documentos de la dependencia
                </label>
                <input
                  id="copernic-workspace-query"
                  ref={queryInputRef}
                  aria-label="Buscar documentos de la dependencia"
                  autoComplete="off"
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && hits.length) {
                      event.preventDefault();
                      if (!selectedId) setSelection(hits[0].documentId);
                      const selectedButton = resultsListRef.current?.querySelector<HTMLButtonElement>(
                        "button[aria-pressed='true']",
                      );
                      (selectedButton ?? resultsListRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
                    }
                  }}
                  placeholder="Palabra, frase o nombre de archivo…"
                />
                {draftQuery && (
                  <button
                    type="button"
                    className={styles.clearQueryButton}
                    aria-label="Limpiar texto de búsqueda"
                    onClick={() => {
                      setDraftQuery("");
                      navigate({ q: null, page: 1, selected: null, match: null });
                    }}
                  >
                    ×
                  </button>
                )}
                <button type="submit" className={styles.searchButton} disabled={!draftQuery.trim() || searching}>
                  {searching ? "Buscando…" : "Buscar"}
                </button>
              </form>
              <div className={styles.filterControls} aria-label="Filtros de búsqueda">
                <label>
                  <span>Tipo</span>
                  <select aria-label="Filtrar por tipo" value={activeType} onChange={(event) => selectType(event.target.value)}>
                    <option value="">Todos</option>
                    <option value="PDF">PDF</option>
                    <option value="TXT">TXT</option>
                    <option value="RTF">RTF</option>
                    <option value="DOC">DOC</option>
                    <option value="DOCX">DOCX</option>
                    <option value="ODT">ODT</option>
                  </select>
                </label>
                <label>
                  <span>Fecha</span>
                  <select aria-label="Filtrar por fecha" value={activeDatePreset} onChange={(event) => selectDatePreset(event.target.value as DatePreset)}>
                    <option value="any">Cualquier fecha</option>
                    <option value="7d">Últimos 7 días</option>
                    <option value="30d">Últimos 30 días</option>
                    <option value="1y">Último año</option>
                    <option value="custom">Personalizada</option>
                  </select>
                </label>
                {activeDatePreset === "custom" && (
                  <>
                    <label>
                      <span>Desde</span>
                      <input aria-label="Fecha desde" type="date" value={activeDateFrom} onChange={(event) => setCustomDate("dateFrom", event.target.value)} />
                    </label>
                    <label>
                      <span>Hasta</span>
                      <input aria-label="Fecha hasta" type="date" value={activeDateTo} onChange={(event) => setCustomDate("dateTo", event.target.value)} />
                    </label>
                  </>
                )}
              </div>
              {dateFilterError && <p className={styles.filterValidation} role="alert">{dateFilterError}</p>}
              <div className={styles.searchTools}>
                <details className={styles.syntaxHelp}>
                  <summary>Ayuda de búsqueda</summary>
                  <div className={styles.syntaxPopover}>
                    <p><code>&quot;daño moral&quot;</code> busca una frase.</p>
                    <p><code>daño AND moral</code> exige ambos términos; <code>OR</code> acepta uno.</p>
                    <p><code>-penal</code> o <code>NOT penal</code> excluye un término.</p>
                    <p><code>*</code> equivale a AND; <code>+</code> equivale a OR.</p>
                    <p><code>%civil</code> y <code>responsabilidad%</code> buscan prefijo/sufijo.</p>
                    <p>También podés usar campos jurídicos compatibles con el buscador.</p>
                  </div>
                </details>
                <span className={styles.searchMode}>Contenido y nombre de archivo</span>
                <span className={styles.searchShortcut}>Ctrl+F para buscar · F3: siguiente coincidencia</span>
              </div>
              {(activeFolderId || activeSourceId || activeType || hasDateFilter) && (
                <div className={styles.filterChips} aria-label="Filtros activos">
                  {activeFolderId && (
                    <button type="button" onClick={() => selectFolder(null)}>
                      Carpeta: {folderName(activeFolderId, folders)} <span aria-hidden="true">×</span>
                    </button>
                  )}
                  {activeSourceId && (
                    <button type="button" onClick={() => selectSource(null)}>
                      Carpeta compartida: {displaySourceName(activeSource?.name ?? (activeSourceId === MANUAL_SOURCE_ID ? "Documentos cargados" : "Carpeta"))} {activeSourceFolder ? `· ${activeSourceFolder.replaceAll("\\", " / ")}` : ""} <span aria-hidden="true">×</span>
                    </button>
                  )}
                  {activeType && (
                    <button type="button" onClick={() => selectType("")}>
                      Tipo: {activeType} <span aria-hidden="true">×</span>
                    </button>
                  )}
                  {hasDateFilter && (
                    <button type="button" onClick={() => selectDatePreset("any")}>
                      Fecha: {dateFilterLabel} <span aria-hidden="true">×</span>
                    </button>
                  )}
                  <button type="button" className={styles.clearFilters} onClick={clearFilters}>Limpiar filtros</button>
                </div>
              )}
            </div>

            <div className={styles.resultsViewport}>
              {offlineSource && (
                <p className={styles.offlineNote} role="status">
                  La carpeta de origen no está disponible en este momento. Los documentos ya incorporados siguen disponibles para búsqueda.
                </p>
              )}
              {message && <p className={styles.notice} role="status">{message}</p>}
              {searchError && <p className={styles.error} role="alert">{searchError}</p>}
              {showWorkspaceListing ? (
                <div className={styles.resultSummary}>
                  <strong>
                    {searching ? "Cargando documentos…" : `${hits.length} ${hits.length === 1 ? "documento" : "documentos"} en esta página`}
                  </strong>
                  {workspaceListPage && <span>· {workspaceListPage.total} accesibles en {activeScope}</span>}
                  {workspaceListPage && workspaceListPage.total > 0 && <span>· Página {workspaceListPage.page}</span>}
                </div>
              ) : committedQuery ? (
                <div className={styles.resultSummary}>
                  <strong>
                    {searching ? "Buscando…" : `${hits.length} ${hits.length === 1 ? "documento" : "documentos"} en esta página`}
                  </strong>
                  {searchPage && <span>· {contentTotal} {searchPage.total === 1 ? "coincidencia" : "coincidencias"} por contenido</span>}
                  {namePage?.total ? <span>· {namePage.total} {namePage.total === 1 ? "coincidencia" : "coincidencias"} por nombre</span> : null}
                  {searchPage?.partial && <span className={styles.partialBadge}>Resultados parciales</span>}
                  {!searchPage && !searching && !searchError && <span>en {activeScope}</span>}
                </div>
              ) : (
                <div className={styles.idleState}>
                  <span className={styles.idleIcon} aria-hidden="true">⌕</span>
                  <h2>Buscá en los documentos de {workspace?.name ?? "tu dependencia"}</h2>
                  <p>Podés buscar por contenido o por nombre. La búsqueda respeta la carpeta compartida que elegiste.</p>
                  <span>PDF y documentos con texto disponible</span>
                </div>
              )}
              {!searching && !searchError && ((showWorkspaceListing && workspaceListPage?.total === 0) || (committedQuery && searchPage && hits.length === 0)) && (
                <div className={styles.emptyResults}>
                  <h2>{activeType || hasDateFilter || activeFolderId || activeSourceId ? "No encontramos documentos con estos filtros." : "Todavía no hay documentos."}</h2>
                  <p>Probá otras palabras, cambiá de carpeta o limpiá los filtros de {activeScope}.</p>
                </div>
              )}
              {searching && hits.length === 0 && (
                <div className={styles.searchLoading} role="status"><span className={styles.spinner} />{showWorkspaceListing ? "Cargando documentos" : "Buscando"} en {workspace?.name ?? "la dependencia"}…</div>
              )}
              {hits.length > 0 && (
                <div
                  ref={resultsListRef}
                  className={styles.resultList}
                  aria-label="Resultados por contenido y nombre"
                  role="list"
                >
                  {hits.map((hit) => {
                    const selected = hit.documentId === selectedId;
                    return (
                      <div
                        className={`${styles.resultRow} ${selected ? styles.resultRowSelected : ""}`}
                        role="listitem"
                        key={hit.documentId}
                      >
                        <button
                          type="button"
                          className={styles.resultSelect}
                          aria-label={`Vista previa de ${hit.filename}`}
                          aria-pressed={selected}
                          onKeyDown={onResultsKeyDown}
                          onClick={() => setSelection(hit.documentId)}
                          onDoubleClick={() => openFullViewer(hit)}
                        >
                          <span className={styles.resultTopline}>
                            <span className={styles.fileGlyph} aria-hidden="true">{hit.fileType}</span>
                            <strong title={hit.filename}>{hit.filename}</strong>
                            <span className={styles.resultPage}>{hit.kind === "LIST" ? "Disponible" : hit.fileType === "PDF" ? "pág. " + hit.page : "texto extraído"}</span>
                          </span>
                          {hit.snippet ? (
                            <span className={styles.resultSnippet}>{highlightSnippet(hit.snippet, committedQuery)}</span>
                          ) : (
                            <span className={styles.nameOnlySnippet}>{hit.kind === "LIST" ? "Documento disponible en esta dependencia." : "Coincidencia en el nombre del archivo."}</span>
                          )}
                          <span className={styles.resultMeta}>
                            <span>{hit.folderName || folderName(hit.folderId, folders)}</span>
                            {hit.sourceName && <span>Carpeta compartida: {displaySourceName(hit.sourceName)}</span>}
                            {hit.sourceFolder && <span>{hit.sourceFolder.replaceAll("\\", " / ")}</span>}
                            <span>{formattedDate(hit.uploadedAt)}</span>
                          </span>
                        </button>
                        <details className={styles.resultMenu}>
                          <summary aria-label={`Acciones para ${hit.filename}`} title="Acciones">⋮</summary>
                          <div className={styles.actionMenu}>
                            <button type="button" onClick={() => openFullViewer(hit)}>Abrir completo</button>
                            <button type="button" onClick={() => void copyValue(hit.filename, "Nombre copiado.")}>Copiar nombre</button>
                            <button
                              type="button"
              onClick={() => void copyValue(`${workspace?.name ?? "Documentos compartidos"} / ${hit.folderName} / ${hit.filename} · página ${hit.page}`, "Referencia copiada.")}
                            >
                              Copiar referencia
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                selectFolder(hit.folderId);
                                setSelection(null);
                              }}
                            >
                              Buscar en esta carpeta
                            </button>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
              {((showWorkspaceListing && workspaceListPage && (workspaceListPage.page > 1 || workspaceListPage.total > workspaceListPage.page * workspaceListPage.pageSize)) || (!showWorkspaceListing && searchPage && (searchPage.page > 1 || searchPage.hasMore || Boolean(namePage && namePage.total > namePage.page * namePage.pageSize)))) && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    disabled={searching || (showWorkspaceListing ? (workspaceListPage?.page ?? 1) <= 1 : (searchPage?.page ?? 1) <= 1)}
                    onClick={() => navigate({ page: (showWorkspaceListing ? workspaceListPage?.page : searchPage?.page ?? 1)! - 1, selected: null, match: null })}
                  >
                    Anterior
                  </button>
                  <span>Página {showWorkspaceListing ? workspaceListPage?.page : searchPage?.page}</span>
                  <button
                    type="button"
                    disabled={searching || !(showWorkspaceListing ? Boolean(workspaceListPage && workspaceListPage.total > workspaceListPage.page * workspaceListPage.pageSize) : Boolean(searchPage && (searchPage.hasMore || (namePage && namePage.total > namePage.page * namePage.pageSize))))}
                    onClick={() => navigate({ page: (showWorkspaceListing ? workspaceListPage?.page : searchPage?.page ?? 1)! + 1, selected: null, match: null })}
                  >
                    Siguiente
                  </button>
                </div>
              )}
              <p className={styles.visuallyHidden} aria-live="polite">{resultsAnnouncement}</p>
            </div>
          </main>

          <aside className={styles.previewPanel} aria-label="Vista previa del documento">
            <div className={styles.panelHeading}>
              <h2>{previewCollapsed ? "" : "Vista previa"}</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={previewCollapsed ? "Expandir vista previa" : "Colapsar vista previa"}
                onClick={() => setPreviewCollapsed((value) => !value)}
              >
                {previewCollapsed ? "‹" : "›"}
              </button>
            </div>
            {!previewCollapsed && (
              selectedHit ? (
                <div className={styles.previewContent}>
                  <header className={styles.previewDocumentHeader}>
                      <p className={styles.previewType}>COMPARTIDO CON {workspace?.name ?? "TU DEPENDENCIA"} · {documentStatusLabel(selectedHit.documentStatus)}</p>
                    <h2 title={preview?.document.file?.filename ?? selectedHit.filename}>
                      {preview?.document.file?.filename ?? selectedHit.filename}
                    </h2>
                    <p>{activeScope}</p>
                    <div className={styles.previewActions}>
                      <Link className={styles.openButton} href={fullViewerHref}>
                        Abrir completo
                      </Link>
                      <button type="button" className={styles.downloadButton} onClick={() => void downloadSelected()}>
                        Descargar
                      </button>
                    </div>
                  </header>
                  {selectedHit.sourceStatus === "MISSING" && (
                    <p className={styles.missingSourceNote}>No pudimos acceder al archivo original. El contenido incorporado sigue disponible para búsqueda.</p>
                  )}
                  {previewLoading && (
                    <div className={styles.previewLoading} role="status">
                      <span className={styles.spinner} />
                      <p>Cargando vista previa…</p>
                      <small>Los resultados siguen disponibles mientras se prepara la vista previa.</small>
                    </div>
                  )}
                  {previewError && (
                    <div className={styles.previewError} role="alert">
                      <p>No se pudo cargar la vista previa.</p>
                      <small>{previewError}</small>
                      <Link href={fullViewerHref}>Abrir documento completo</Link>
                    </div>
                  )}
                  {preview && !previewLoading && (
                    <>
                      {preview.document.status === "OCR_PROCESSING" && (
                        <p className={styles.missingSourceNote}>Procesando documento… La búsqueda se actualizará cuando termine.</p>
                      )}
                      {preview.document.status === "OCR_REQUIRED" && (
                        <p className={styles.missingSourceNote}>Procesando documento… El texto todavía no está disponible para buscar.</p>
                      )}
                      {preview.document.status === "OCR_FAILED" && (
                        <p className={styles.missingSourceNote}>No pudimos extraer el texto de este archivo.</p>
                      )}
                      {preview.document.selectedPage?.textKind === "OCR" && (
                        <p className={styles.missingSourceNote}>Texto reconocido automáticamente. La navegación está disponible; el resaltado visual no está disponible para texto reconocido.</p>
                      )}
                      <div className={styles.previewToolbar}>
                        <span>
                          {preview.document.file?.mimeType === "application/pdf" ? "Página " + previewPage + " de " + (previewPageCount || preview.document.file?.pageCount || preview.document.extraction?.pageCount || "?") : "Texto extraído"}
                        </span>
                        <div className={styles.pageControls} hidden={preview.document.file?.mimeType !== "application/pdf"}>
                          <button
                            type="button"
                            aria-label="Página anterior"
                            disabled={previewPage <= 1}
                            onClick={() => setPreviewPage((value) => Math.max(1, value - 1))}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            aria-label="Página siguiente"
                            disabled={!!previewPageCount && previewPage >= previewPageCount}
                            onClick={() => setPreviewPage((value) => value + 1)}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                      {preview.document.file?.mimeType === "application/pdf" ? (
                        <div className={styles.pdfPreview}>
                          <CorpusPdfViewer
                            file={preview.fileUrl}
                            page={previewPage}
                            matches={preview.matches.matches}
                            activeMatch={selectedMatchIndex}
                            onLoadSuccess={setPreviewPageCount}
                            structurePath={`/workspaces/${workspaceId}/documents/${preview.document.id}/structure`}
                            onGoToPage={setPreviewPage}
                          />
                        </div>
                      ) : preview.document.file ? (
                        <pre className={styles.textPreview} aria-label="Vista previa del texto extraído">
                          {renderTextPreview(
                            preview.document.selectedPage?.text ?? "",
                            preview.matches.matches,
                            preview.matches.matches[selectedMatchIndex]?.ordinal ?? 0,
                          )}
                        </pre>
                      ) : (
                        <div className={styles.previewMessage}>
                          <p>La vista previa textual no está disponible para este formato.</p>
                          <p>{selectedHit.snippet ?? "Podés abrir o descargar el documento."}</p>
                        </div>
                      )}
                      <div className={styles.matchNavigator}>
                        <span aria-live="polite">
                          {preview.matches.matches.length
                            ? `Coincidencia ${Math.min(selectedMatchIndex + 1, preview.matches.matches.length)} de ${preview.matches.total}${preview.matches.truncated ? "+" : ""}`
                            : "Sin coincidencias de texto en este documento"}
                        </span>
                        <div>
                          <button
                            type="button"
                            aria-label="Coincidencia anterior"
                            disabled={!preview.matches.matches.length}
                            onClick={() => navigateMatch(-1)}
                          >
                            Anterior
                          </button>
                          <button
                            type="button"
                            aria-label="Coincidencia siguiente"
                            disabled={!preview.matches.matches.length}
                            onClick={() => navigateMatch(1)}
                          >
                            Siguiente
                          </button>
                        </div>
                      </div>
                      {preview.matches.truncated && (
                        <p className={styles.truncatedNote}>Se muestran las primeras 500 coincidencias.</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className={styles.previewEmpty}>
                  <span aria-hidden="true">▤</span>
                  <p>Seleccioná un documento para verlo acá.</p>
                  <small>Enter muestra la vista previa · doble clic abre el documento completo.</small>
                </div>
              )
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
