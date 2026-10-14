"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import styles from "../spaces.module.css";

type WorkspaceRole = "ADMIN" | "EDITOR" | "VIEWER";
type Workspace = {
  id: string;
  code: string;
  name: string;
  type: string;
  role: WorkspaceRole;
};
type AdminWorkspace = Omit<Workspace, "role"> & {
  active: boolean;
  administrators: Array<{
    id: number;
    nombre: string;
    apellido: string | null;
    email: string;
  }>;
};
type Folder = {
  id: string;
  parentId: string | null;
  name: string;
  _count: { documents: number; children: number };
};
type WorkspaceDocument = {
  documentId: string;
  createdAt: string;
  folder: { id: string; name: string } | null;
  uploadedBy: { nombre: string; apellido: string | null };
  document: {
    title: string;
    status: string;
    file: { filename: string; sizeBytes: number } | null;
    extraction: { status: string; pageCount: number } | null;
  };
};
type WorkspaceMember = {
  userId: number;
  role: WorkspaceRole;
  active: boolean;
  user: { nombre: string; apellido: string | null; email: string };
};
type MemberCandidate = {
  id: number;
  nombre: string;
  apellido: string | null;
  email: string;
};
type ActivityItem = {
  id: number;
  accion: string;
  descripcion: string | null;
  createdAt: string;
  nombre: string;
  apellido: string | null;
};
type SourceRun = {
  id: string;
  status: string;
  scanComplete: boolean;
  filesSeen: number;
  indexedCount: number;
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  metadataOnlyCount: number;
  renamedCount: number;
  missingCount: number;
  unsupportedCount: number;
  errorCount: number;
  hashCount: number;
  totalDurationMs: number;
  errorMessage: string | null;
};
type DocumentSource = {
  id: string;
  name: string;
  type: string;
  path: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastSuccessfulScanAt: string | null;
  fileCount: number;
  lastRun: SourceRun | null;
};
type SearchResult = {
  id: string;
  sourceId: string;
  title: string | null;
  date: string | null;
  snippet: string | null;
  metadata: Record<string, string | number | boolean | null>;
};
type SearchPage = {
  total: number;
  totalExact?: boolean;
  partial?: boolean;
  hasMore?: boolean;
  page: number;
  pageSize: number;
  results: SearchResult[];
};
type NameSearch = {
  total: number;
  totalExact: boolean;
  results: Array<{
    documentId: string;
    title: string;
    filename: string;
    status: string;
    uploadedAt: string;
    folder: { id: string; name: string } | null;
  }>;
};
type UploadRow = {
  id: string;
  name: string;
  size: number;
  status: string;
  message?: string;
};
type PendingConfirmation = {
  kind: "member" | "workspace";
  id: string;
  label: string;
  active: boolean;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ROLE_LABEL: Record<WorkspaceRole, string> = {
  ADMIN: "Administrador del espacio",
  EDITOR: "Editor",
  VIEWER: "Consulta",
};
const TYPE_LABEL: Record<string, string> = {
  JUZGADO: "Juzgado",
  SALA: "Sala",
  SECRETARIA: "Secretaría",
  DEPENDENCIA: "Dependencia",
};

function friendlyError(cause: unknown, fallback: string) {
  if (!(cause instanceof ApiError)) return fallback;
  if (cause.status === 400 && /ya existe|código.*usado/iu.test(cause.message))
    return "Ese código de dependencia ya está registrado. Revisá la administración de espacios.";
  if (cause.status === 400)
    return "Revisá los datos ingresados e intentá nuevamente.";
  if (cause.status === 401) return "Tu sesión venció. Volvé a ingresar.";
  if (cause.status === 403) return "Tu rol no permite realizar esta acción.";
  if (cause.status === 404)
    return "El espacio o documento ya no está disponible para tu cuenta.";
  if (cause.status === 413) return "El archivo supera el límite de 20 MB.";
  if (cause.status >= 500)
    return "Ocurrió un problema al procesar la solicitud. Podés volver a intentarlo.";
  return fallback;
}

function roleLabel(role?: WorkspaceRole) {
  return role ? ROLE_LABEL[role] : "Sin rol asignado";
}
function typeLabel(type: string) {
  return TYPE_LABEL[type] ?? "Dependencia";
}
function statusLabel(status?: string) {
  if (status === "INDEXED" || status === "TEXT_EXTRACTED")
    return "Listo para buscar";
  if (status === "OCR_REQUIRED") return "Requiere OCR";
  if (status === "ERROR" || status === "INVALID_PDF")
    return "Error de procesamiento";
  return "Procesando";
}
function formatBytes(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
function formatDate(value?: string | null) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(date);
}
function folderPath(folderId: string | null | undefined, folders: Folder[]) {
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
function highlightedSnippet(snippet: string, query: string) {
  const terms = [...new Set(query.match(/[\p{L}\p{N}]{3,}/gu) ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  if (!terms.length) return snippet;
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
    "giu",
  );
  return snippet
    .split(expression)
    .map((part, index) =>
      terms.some(
        (term) =>
          term.localeCompare(part, undefined, { sensitivity: "accent" }) === 0,
      ) ? (
        <mark key={`${part}-${index}`}>{part}</mark>
      ) : (
        part
      ),
    );
}

export default function PrivateSpacesPage() {
  const { user } = useAuth();
  const globalAdmin = user?.rol.nombre === "ADMIN";
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [adminWorkspaces, setAdminWorkspaces] = useState<AdminWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [folderId, setFolderId] = useState("");
  const [searchFolderMode, setSearchFolderMode] = useState<"ALL" | "CURRENT">(
    "ALL",
  );
  const [query, setQuery] = useState("");
  const [searchPage, setSearchPage] = useState<SearchPage | null>(null);
  const [nameSearch, setNameSearch] = useState<NameSearch | null>(null);
  const restoreSearch = useRef(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState("");
  const [renamedFolder, setRenamedFolder] = useState("");
  const [depCode, setDepCode] = useState("");
  const [depName, setDepName] = useState("");
  const [depType, setDepType] = useState("JUZGADO");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sourceTestStatus, setSourceTestStatus] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<MemberCandidate[]>(
    [],
  );
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("VIEWER");
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<
    Record<number, WorkspaceRole>
  >({});
  const [documentMoveTargets, setDocumentMoveTargets] = useState<
    Record<string, string>
  >({});
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  const canEdit =
    selectedWorkspace?.role === "ADMIN" || selectedWorkspace?.role === "EDITOR";
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const childFolders = useMemo(
    () => folders.filter((folder) => folder.parentId === (folderId || null)),
    [folders, folderId],
  );
  const orderedFolders = useMemo(
    () =>
      [...folders].sort((a, b) =>
        folderPath(a.id, folders).localeCompare(
          folderPath(b.id, folders),
          "es",
        ),
      ),
    [folders],
  );

  const refresh = useCallback(
    async (nextId: string, nextFolderId = folderId) => {
      if (!nextId) return;
      const queryFolder = nextFolderId || "ROOT";
      const [nextFolders, nextDocuments] = await Promise.all([
        api.get<Folder[]>(`/workspaces/${nextId}/folders`),
        api.get<WorkspaceDocument[]>(`/workspaces/${nextId}/documents`, {
          query: { folderId: queryFolder },
        }),
      ]);
      setFolders(nextFolders);
      setDocuments(nextDocuments);
      const selected = workspaces.find((workspace) => workspace.id === nextId);
      if (selected?.role === "ADMIN") {
        const [nextMembers, nextActivity] = await Promise.all([
          api.get<WorkspaceMember[]>(`/workspaces/${nextId}/members`),
          api.get<ActivityItem[]>(`/workspaces/${nextId}/activity`),
        ]);
        const nextSources = await api.get<DocumentSource[]>(
          `/workspaces/${nextId}/sources`,
        );
        setMembers(nextMembers);
        setActivity(nextActivity);
        setSources(nextSources);
        setMemberRoleDrafts(
          Object.fromEntries(
            nextMembers.map((member) => [member.userId, member.role]),
          ),
        );
      } else {
        setMembers([]);
        setActivity([]);
        setSources([]);
      }
    },
    [folderId, workspaces],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.get<Workspace[]>("/workspaces/mine"),
      globalAdmin
        ? api.get<AdminWorkspace[]>("/workspaces/admin/list")
        : Promise.resolve([]),
    ])
      .then(([mine, administered]) => {
        if (!active) return;
        const searchParams = new URLSearchParams(window.location.search);
        setWorkspaces(mine);
        setAdminWorkspaces(administered);
        const requestedId = searchParams.get("workspaceId");
        const preferred =
          requestedId && mine.some((workspace) => workspace.id === requestedId)
            ? requestedId
            : (mine[0]?.id ?? "");
        setWorkspaceId(preferred);
        setFolderId(searchParams.get("folderId") ?? "");
        setQuery(searchParams.get("q") ?? "");
        setSearchFolderMode(
          searchParams.get("searchFolderMode") === "CURRENT"
            ? "CURRENT"
            : "ALL",
        );
        const restoredQuery = searchParams.get("q") ?? "";
        setPageNumber(Math.max(1, Number(searchParams.get("page") ?? 1)));
        restoreSearch.current = restoredQuery.trim().length > 0;
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            friendlyError(
              cause,
              "No se pudieron cargar los espacios documentales.",
            ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [globalAdmin]);

  useEffect(() => {
    if (!workspaceId || loading) return;
    // The refresh synchronizes this view with the selected workspace and folder.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(workspaceId, folderId).catch((cause: unknown) =>
      setError(
        friendlyError(cause, "No se pudo cargar este espacio documental."),
      ),
    );
  }, [workspaceId, folderId, loading, refresh]);

  useEffect(() => {
    if (!globalAdmin) return;
    void api
      .get<AdminWorkspace[]>("/workspaces/admin/list")
      .then(setAdminWorkspaces)
      .catch((cause: unknown) =>
        setError(
          friendlyError(
            cause,
            "No se pudo cargar la administración de espacios.",
          ),
        ),
      );
  }, [globalAdmin]);

  useEffect(() => {
    if (
      selectedWorkspace?.role !== "ADMIN" ||
      !sources.some((source) =>
        ["QUEUED", "RUNNING"].includes(source.lastRun?.status ?? ""),
      )
    ) return;
    const timer = window.setInterval(() => {
      void api
        .get<DocumentSource[]>(`/workspaces/${workspaceId}/sources`)
        .then(setSources)
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedWorkspace?.role, sources, workspaceId]);

  function clearSearch() {
    setSearchPage(null);
    setNameSearch(null);
  }

  async function testSourceAccess() {
    if (!workspaceId || !sourcePath.trim()) return;
    setSourceBusy(true);
    setSourceTestStatus("");
    setError("");
    try {
      const result = await api.post<{ status: string }>(
        `/workspaces/${workspaceId}/sources/test-access`,
        { path: sourcePath },
      );
      setSourceTestStatus(result.status);
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo probar el acceso a la fuente."));
    } finally {
      setSourceBusy(false);
    }
  }

  async function createSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || sourceTestStatus !== "CONNECTED") return;
    setSourceBusy(true);
    setError("");
    try {
      await api.post(`/workspaces/${workspaceId}/sources`, {
        name: sourceName,
        path: sourcePath,
      });
      setSources(await api.get<DocumentSource[]>(`/workspaces/${workspaceId}/sources`));
      setSourceName("");
      setSourcePath("");
      setSourceTestStatus("");
      setNotice("Fuente documental creada.");
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo crear la fuente documental."));
    } finally {
      setSourceBusy(false);
    }
  }

  async function scanSource(source: DocumentSource) {
    setSourceBusy(true);
    setError("");
    try {
      await api.post(`/workspaces/${workspaceId}/sources/${source.id}/scan`);
      setSources(await api.get<DocumentSource[]>(`/workspaces/${workspaceId}/sources`));
      setNotice(`Escaneo iniciado para ${source.name}.`);
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo iniciar el escaneo."));
    } finally {
      setSourceBusy(false);
    }
  }

  async function toggleSource(source: DocumentSource) {
    setSourceBusy(true);
    setError("");
    try {
      await api.patch(`/workspaces/${workspaceId}/sources/${source.id}`, {
        enabled: !source.enabled,
      });
      setSources(await api.get<DocumentSource[]>(`/workspaces/${workspaceId}/sources`));
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo actualizar la fuente."));
    } finally {
      setSourceBusy(false);
    }
  }

  async function createWorkspace() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await api.post<Workspace>("/workspaces", {
        code: depCode,
        name: depName,
        type: depType,
      });
      setWorkspaces((items) => [
        ...items.filter((item) => item.id !== created.id),
        created,
      ]);
      setWorkspaceId(created.id);
      setFolderId("");
      setDepCode("");
      setDepName("");
      setNotice(
        "Espacio creado. Ya figurás como administrador de esta dependencia.",
      );
      setShowCreateWorkspace(false);
      if (globalAdmin)
        setAdminWorkspaces(
          await api.get<AdminWorkspace[]>("/workspaces/admin/list"),
        );
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo crear el espacio documental."));
    } finally {
      setBusy(false);
    }
  }

  async function setWorkspaceActive(
    workspace: AdminWorkspace,
    active: boolean,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.patch(`/workspaces/admin/${workspace.id}/active`, { active });
      const next = await api.get<AdminWorkspace[]>("/workspaces/admin/list");
      setAdminWorkspaces(next);
      const mine = await api.get<Workspace[]>("/workspaces/mine");
      setWorkspaces(mine);
      if (workspaceId === workspace.id && !active) {
        setWorkspaceId(mine[0]?.id ?? "");
        setFolderId("");
        clearSearch();
      }
      setNotice(
        active
          ? "Espacio reactivado."
          : "Espacio desactivado. Sus miembros ya no pueden acceder.",
      );
    } catch (cause) {
      setError(
        friendlyError(cause, "No se pudo actualizar el estado del espacio."),
      );
    } finally {
      setBusy(false);
      setPendingConfirmation(null);
    }
  }

  async function addFolder() {
    if (!newFolder.trim() || !workspaceId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/workspaces/${workspaceId}/folders`, {
        name: newFolder,
        parentId: folderId || null,
      });
      setNewFolder("");
      await refresh(workspaceId, folderId);
      setNotice("Carpeta creada.");
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo crear la carpeta."));
    } finally {
      setBusy(false);
    }
  }

  async function renameFolder() {
    if (!workspaceId || !renamingFolderId || !renamedFolder.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.patch(
        `/workspaces/${workspaceId}/folders/${renamingFolderId}`,
        { name: renamedFolder },
      );
      setRenamingFolderId("");
      setRenamedFolder("");
      await refresh(workspaceId, folderId);
      setNotice("Nombre de carpeta actualizado.");
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo renombrar la carpeta."));
    } finally {
      setBusy(false);
    }
  }

  function updateUploadRow(id: string, patch: Partial<UploadRow>) {
    setUploadRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!files.length || !workspaceId) return;
    const selected = Array.from(files);
    const rows: UploadRow[] = selected.map((file, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      size: file.size,
      status:
        !file.name.toLowerCase().endsWith(".pdf") ||
        (file.type && file.type !== "application/pdf")
          ? "Archivo no PDF"
          : file.size > MAX_FILE_BYTES
            ? "Supera 20 MB"
            : "En espera",
      message:
        !file.name.toLowerCase().endsWith(".pdf") ||
        (file.type && file.type !== "application/pdf")
          ? "Elegí un archivo PDF."
          : file.size > MAX_FILE_BYTES
            ? "El límite por archivo es 20 MB."
            : undefined,
    }));
    if (rows.length > 20) {
      rows.slice(20).forEach((row) => {
        row.status = "Fuera del límite";
        row.message = "Podés cargar hasta 20 archivos por tanda.";
      });
    }
    setUploadRows(rows);
    setUploading(true);
    setError("");
    setNotice("");
    let finished = 0;
    for (let index = 0; index < Math.min(selected.length, 20); index += 1) {
      const file = selected[index];
      const row = rows[index];
      if (row.message) continue;
      updateUploadRow(row.id, { status: "Subiendo y procesando…" });
      const form = new FormData();
      form.append("files", file);
      try {
        const response = await api.post<{
          results: Array<{
            status: string;
            duplicate: boolean;
            message?: string;
          }>;
        }>(
          `/workspaces/${workspaceId}/documents/upload${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
          form,
        );
        const result = response.results[0];
        if (!result || result.status === "ERROR") {
          updateUploadRow(row.id, {
            status: "Error",
            message: result?.message || "El PDF no pudo procesarse.",
          });
        } else if (result.duplicate) {
          updateUploadRow(row.id, {
            status: "Ya estaba en este espacio",
            message: "El documento ya existe en este espacio.",
          });
        } else {
          updateUploadRow(row.id, {
            status:
              result.status === "OCR_REQUIRED"
                ? "Requiere OCR"
                : "Listo para buscar",
            message:
              result.status === "OCR_REQUIRED"
                ? "Se puede abrir; no aparece en búsqueda por contenido hasta procesar OCR."
                : "Documento incorporado.",
          });
        }
      } catch (cause) {
        updateUploadRow(row.id, {
          status: "Error",
          message: friendlyError(cause, "No se pudo procesar este PDF."),
        });
      }
      finished += 1;
    }
    setUploading(false);
    await refresh(workspaceId, folderId);
    const errors = rows.filter(
      (row) => row.message && row.status !== "Ya estaba en este espacio",
    ).length;
    const duplicates = rows.filter(
      (row) => row.status === "Ya estaba en este espacio",
    ).length;
    setNotice(
      `${finished} archivo(s) procesado(s).${duplicates ? ` ${duplicates} ya existían en este espacio.` : ""}${errors ? ` ${errors} requieren atención; el resto de la tanda continuó.` : ""}`,
    );
  }

  const runSearch = useCallback(
    async (nextPage = 1) => {
      if (!query.trim() || !workspaceId) return;
      setBusy(true);
      setError("");
      setNotice("");
      setPageNumber(nextPage);
      const scope =
        searchFolderMode === "CURRENT" ? folderId || "ROOT" : undefined;
      try {
        const [textResults, filenameResults] = await Promise.all([
          api.get<SearchPage>(`/workspaces/${workspaceId}/search`, {
            query: { q: query, page: nextPage, pageSize: 20, folderId: scope },
          }),
          query.trim().length >= 2
            ? api.get<NameSearch>(`/workspaces/${workspaceId}/search/names`, {
                query: { q: query, page: 1, pageSize: 20, folderId: scope },
              })
            : Promise.resolve(null),
        ]);
        setSearchPage(textResults);
        setNameSearch(filenameResults);
      } catch (cause) {
        setError(
          friendlyError(
            cause,
            "No se pudo completar la búsqueda en este espacio.",
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [folderId, query, searchFolderMode, workspaceId],
  );

  useEffect(() => {
    if (!restoreSearch.current || loading || !workspaceId || !query.trim()) return;
    restoreSearch.current = false;
    // Restores the URL-backed search after the workspace list has loaded.
    void runSearch(pageNumber);
  }, [loading, pageNumber, query, runSearch, workspaceId]);

  async function findMemberCandidates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (memberQuery.trim().length < 3 || !workspaceId) return;
    setBusy(true);
    setError("");
    setMemberCandidates([]);
    try {
      setMemberCandidates(
        await api.get<MemberCandidate[]>(
          `/workspaces/${workspaceId}/member-candidates`,
          { query: { q: memberQuery.trim() } },
        ),
      );
    } catch (cause) {
      setError(friendlyError(cause, "No se pudieron buscar usuarios activos."));
    } finally {
      setBusy(false);
    }
  }

  async function saveMember(
    userId: number,
    role: WorkspaceRole,
    active = true,
  ) {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/workspaces/${workspaceId}/members`, {
        userId,
        role,
        active,
      });
      await refresh(workspaceId, folderId);
      setMemberCandidates([]);
      setMemberQuery("");
      setNotice(
        active
          ? "Membresía guardada."
          : "La persona ya no tiene acceso a este espacio.",
      );
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo actualizar la membresía."));
    } finally {
      setBusy(false);
      setPendingConfirmation(null);
    }
  }

  async function moveDocument(documentId: string) {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const folder = documentMoveTargets[documentId] ?? "";
      await api.patch(
        `/workspaces/${workspaceId}/documents/${documentId}/folder`,
        { folderId: folder || null },
      );
      await refresh(workspaceId, folderId);
      setNotice("Documento movido.");
    } catch (cause) {
      setError(friendlyError(cause, "No se pudo mover el documento."));
    } finally {
      setBusy(false);
    }
  }

  const currentFolderAncestors = useMemo(() => {
    if (!folderId) return [];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ancestors: Folder[] = [];
    let current = byId.get(folderId);
    while (current && ancestors.length <= folders.length) {
      ancestors.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return ancestors;
  }, [folderId, folders]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Mi espacio"
        description="Documentos privados de tus dependencias. La búsqueda queda dentro del espacio seleccionado."
      />
      {error && (
        <p role="alert" className={styles.inlineError}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.inlineSuccess}>
          {notice}
        </p>
      )}

      {loading ? (
        <Card>
          <p className={styles.muted}>Cargando tus espacios documentales…</p>
        </Card>
      ) : workspaces.length > 0 ? (
        <>
          <Card>
            <div className={styles.workspaceHeader}>
              <div>
                <p className={styles.eyebrow}>Espacio documental privado</p>
                <h2>{selectedWorkspace?.name ?? "Cargando espacio…"}</h2>
                <p className={styles.muted}>
                  {selectedWorkspace
                    ? `${typeLabel(selectedWorkspace.type)} · Código ${selectedWorkspace.code}`
                    : "El contenido está limitado por tu membresía."}
                </p>
              </div>
              {selectedWorkspace && (
                <span className={styles.roleBadge}>
                  Tu rol: {roleLabel(selectedWorkspace.role)}
                </span>
              )}
            </div>
            {workspaces.length > 1 && (
              <div className={styles.toolbar}>
                <label>
                  Espacio activo
                  <select
                    aria-label="Espacio documental"
                    value={workspaceId}
                    onChange={(event) => {
                      setWorkspaceId(event.target.value);
                      setFolderId("");
                      clearSearch();
                      setUploadRows([]);
                    }}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name} · {typeLabel(workspace.type)} ·{" "}
                        {roleLabel(workspace.role)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {workspaces.length === 1 && (
              <p className={styles.muted}>
                Tu espacio asignado se abrió automáticamente.
              </p>
            )}
            <nav aria-label="Ruta de carpetas" className={styles.breadcrumb}>
              <button type="button" onClick={() => setFolderId("")}>
                Mi espacio
              </button>
              <span>›</span>
              <span>{selectedWorkspace?.name}</span>
              {currentFolderAncestors.map((folder) => (
                <span key={folder.id} className={styles.breadcrumb}>
                  <span>›</span>
                  <button
                    type="button"
                    onClick={() => setFolderId(folder.id)}
                    aria-current={folder.id === folderId ? "page" : undefined}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          </Card>

          <Card className={styles.searchCard}>
            <div>
              <p className={styles.eyebrow}>Búsqueda privada</p>
              <h2>Encontrá documentos de este espacio</h2>
              <p className={styles.scopeText}>
                Buscando en: {selectedWorkspace?.name}
                {searchFolderMode === "CURRENT"
                  ? ` · ${folderPath(folderId, folders)}`
                  : " · todas las carpetas"}
              </p>
            </div>
            <form
              className={styles.searchForm}
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch(1);
              }}
            >
              <input
                className={styles.searchInput}
                aria-label="Buscar documentos privados"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  clearSearch();
                }}
                placeholder={`Buscar dentro de ${selectedWorkspace?.name ?? "este espacio"}…`}
              />
              <button
                className={styles.primaryButton}
                disabled={busy || !query.trim()}
              >
                {busy ? "Buscando…" : "Buscar"}
              </button>
            </form>
            <div className={styles.toolbar}>
              <label>
                Alcance de carpeta
                <select
                  aria-label="Alcance de carpeta para la búsqueda"
                  value={searchFolderMode}
                  onChange={(event) =>
                    setSearchFolderMode(event.target.value as "ALL" | "CURRENT")
                  }
                >
                  <option value="ALL">Todas las carpetas</option>
                  <option value="CURRENT">
                    Esta carpeta: {folderPath(folderId, folders)}
                  </option>
                </select>
              </label>
              {searchPage && (
                <p className={styles.muted}>
                  {searchPage.totalExact === false
                    ? `${searchPage.total} resultados en la ventana analizada (total parcial)`
                    : `${searchPage.total} resultado(s) por contenido`}
                  {searchPage.partial ? " · búsqueda parcial" : ""}
                </p>
              )}
            </div>
            {searchPage &&
              searchPage.results.length === 0 &&
              (!nameSearch || nameSearch.results.length === 0) && (
                <p className={styles.emptyState}>
                  No encontramos resultados en este espacio. Probá otros
                  términos o elegí todas las carpetas.
                </p>
              )}
            {searchPage?.results.length ? (
              <div
                className={styles.resultList}
                aria-label="Resultados por contenido"
              >
                {searchPage.results.map((result) => {
                  const page = Number(result.metadata.pageNumber || 1);
                  const filename = String(
                    result.metadata.filename || result.title || "Documento",
                  );
                  const viewerHref = `/spaces/${workspaceId}/documents/${result.sourceId}?q=${encodeURIComponent(query)}&page=${page}&workspaceId=${encodeURIComponent(workspaceId)}&workspaceName=${encodeURIComponent(selectedWorkspace?.name ?? "")}&folderId=${encodeURIComponent(folderId)}&searchFolderMode=${searchFolderMode}&searchPage=${pageNumber}`;
                  return (
                    <article className={styles.resultCard} key={result.id}>
                      <h3>
                        <Link href={viewerHref}>{filename}</Link>
                      </h3>
                      {result.snippet && (
                        <p className={styles.snippet}>
                          {highlightedSnippet(result.snippet, query)}
                        </p>
                      )}
                      <div className={styles.resultMeta}>
                        <span>Página {page}</span>
                        {typeof result.metadata.sourceName === "string" &&
                          result.metadata.sourceName && (
                            <span>Fuente: {result.metadata.sourceName}</span>
                          )}
                        <span>
                          Carpeta:{" "}
                          {folderPath(
                            typeof result.metadata.folderId === "string"
                              ? result.metadata.folderId
                              : null,
                            folders,
                          )}
                        </span>
                        {result.metadata.uploadedAt && (
                          <span>
                            Subido{" "}
                            {formatDate(String(result.metadata.uploadedAt))}
                          </span>
                        )}
                        {result.metadata.status && (
                          <span>
                            {statusLabel(String(result.metadata.status))}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
            {nameSearch && nameSearch.total > 0 && (
              <section>
                <h3>Coincidencias por nombre ({nameSearch.total})</h3>
                <p className={styles.muted}>
                  Encontramos estos archivos por su nombre. Se muestran aparte
                  de la búsqueda por contenido.
                </p>
                <div className={styles.resultList}>
                  {nameSearch.results.map((result) => (
                    <article
                      className={styles.resultCard}
                      key={result.documentId}
                    >
                      <h3>
                        <Link
                          href={`/spaces/${workspaceId}/documents/${result.documentId}?page=1&workspaceId=${encodeURIComponent(workspaceId)}&workspaceName=${encodeURIComponent(selectedWorkspace?.name ?? "")}&folderId=${encodeURIComponent(folderId)}&searchFolderMode=${searchFolderMode}&searchPage=${pageNumber}`}
                        >
                          {result.filename}
                        </Link>
                      </h3>
                      <div className={styles.resultMeta}>
                        <span>
                          Carpeta:{" "}
                          {result.folder?.name ?? "Todos los documentos"}
                        </span>
                        <span>Subido {formatDate(result.uploadedAt)}</span>
                        <span>{statusLabel(result.status)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {searchPage && (searchPage.page > 1 || searchPage.hasMore) && (
              <div className={styles.pagination}>
                <button
                  disabled={busy || searchPage.page <= 1}
                  onClick={() => void runSearch(searchPage.page - 1)}
                >
                  Anterior
                </button>
                <span>Página {searchPage.page}</span>
                <button
                  disabled={busy || !searchPage.hasMore}
                  onClick={() => void runSearch(searchPage.page + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
          </Card>

          {canEdit && (
            <Card>
              <div>
                <p className={styles.eyebrow}>Carga documental</p>
                <h2>Subir archivos PDF</h2>
                <p className={styles.muted}>
                  Hasta 20 PDF por tanda y 20 MB por archivo. Cada archivo
                  informa su propio resultado.
                </p>
              </div>
              <div
                className={`${styles.uploadZone} ${dragActive ? styles.uploadZoneActive : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void uploadFiles(event.dataTransfer.files);
                }}
              >
                <strong>
                  {dragActive
                    ? "Soltá los archivos para agregarlos a la tanda"
                    : "Arrastrá los PDF hasta acá"}
                </strong>
                <span className={styles.muted}>
                  Los archivos se procesan de a uno; un error no detiene los
                  demás.
                </span>
                <label className={styles.uploadLabel}>
                  Seleccionar archivos
                  <input
                    className={styles.uploadInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    disabled={uploading}
                    aria-label="Seleccionar archivos PDF"
                    onChange={(event) => {
                      if (event.currentTarget.files)
                        void uploadFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {uploadRows.length > 0 && (
                <div className={styles.uploadQueue} aria-live="polite">
                  {uploadRows.map((row) => (
                    <div className={styles.fileLine} key={row.id}>
                      <div>
                        <span className={styles.fileName}>{row.name}</span>
                        <div className={styles.fileStatus}>
                          {formatBytes(row.size)} · {row.status}
                          {row.message ? ` · ${row.message}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card>
            <div className={styles.workspaceHeader}>
              <div>
                <p className={styles.eyebrow}>Organización</p>
                <h2>Carpetas y documentos</h2>
                <p className={styles.muted}>
                  Podés consultar la raíz sin crear carpetas. Los movimientos
                  quedan dentro de este espacio.
                </p>
              </div>
              {canEdit && (
                <form
                  className={styles.inlineForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addFolder();
                  }}
                >
                  <label>
                    Nueva carpeta
                    <input
                      aria-label="Nombre de carpeta"
                      value={newFolder}
                      onChange={(event) => setNewFolder(event.target.value)}
                      placeholder={
                        currentFolder
                          ? "Nombre de subcarpeta"
                          : "Nombre de carpeta"
                      }
                    />
                  </label>
                  <button disabled={busy || !newFolder.trim()}>
                    {currentFolder ? "Crear subcarpeta" : "Crear carpeta"}
                  </button>
                </form>
              )}
            </div>
            {childFolders.length > 0 ? (
              <div className={styles.folderGrid}>
                {childFolders.map((folder) => (
                  <div className={styles.folderRow} key={folder.id}>
                    {renamingFolderId === folder.id ? (
                      <form
                        className={styles.folderRename}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void renameFolder();
                        }}
                      >
                        <input
                          aria-label="Nuevo nombre de carpeta"
                          value={renamedFolder}
                          onChange={(event) =>
                            setRenamedFolder(event.target.value)
                          }
                          autoFocus
                        />
                        <button disabled={busy || !renamedFolder.trim()}>
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingFolderId("");
                            setRenamedFolder("");
                          }}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          className={styles.folderOpen}
                          onClick={() => {
                            setFolderId(folder.id);
                            clearSearch();
                          }}
                        >
                          <strong>📁 {folder.name}</strong>
                          <small>
                            {folder._count.documents} documentos ·{" "}
                            {folder._count.children} subcarpetas
                          </small>
                        </button>
                        {canEdit && (
                          <button
                            aria-label={`Renombrar ${folder.name}`}
                            onClick={() => {
                              setRenamingFolderId(folder.id);
                              setRenamedFolder(folder.name);
                            }}
                          >
                            Renombrar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyState}>
                {folderId
                  ? "Esta carpeta todavía no tiene subcarpetas."
                  : "Todavía no hay carpetas. Podés subir documentos a la raíz o crear una carpeta."}
              </p>
            )}
          </Card>

          <Card>
            <div className={styles.workspaceHeader}>
              <div>
                <p className={styles.eyebrow}>
                  {folderId ? "Contenido de carpeta" : "Actividad documental"}
                </p>
                <h2>
                  {folderId
                    ? folderPath(folderId, folders)
                    : "Documentos recientes"}
                </h2>
              </div>
              <span className={styles.muted}>Ordenados por fecha de carga</span>
            </div>
            {documents.length ? (
              <div className={styles.documentList}>
                {documents.map((item) => (
                  <article
                    className={styles.documentCard}
                    key={item.documentId}
                  >
                    <div>
                      <h3>
                        <Link
                          href={`/spaces/${workspaceId}/documents/${item.documentId}?workspaceId=${encodeURIComponent(workspaceId)}&workspaceName=${encodeURIComponent(selectedWorkspace?.name ?? "")}&folderId=${encodeURIComponent(folderId)}&searchFolderMode=${searchFolderMode}&searchPage=${pageNumber}&q=${encodeURIComponent(query)}`}
                        >
                          {item.document.file?.filename ?? item.document.title}
                        </Link>
                      </h3>
                      <div className={styles.resultMeta}>
                        <span>{statusLabel(item.document.status)}</span>
                        <span>
                          {item.document.extraction?.pageCount ?? 0} páginas
                        </span>
                        <span>
                          {formatBytes(item.document.file?.sizeBytes ?? 0)}
                        </span>
                        <span>
                          Subido {formatDate(item.createdAt)} por{" "}
                          {item.uploadedBy.nombre}{" "}
                          {item.uploadedBy.apellido ?? ""}
                        </span>
                        {item.folder && (
                          <span>
                            Carpeta: {folderPath(item.folder.id, folders)}
                          </span>
                        )}
                      </div>
                      {item.document.status === "OCR_REQUIRED" && (
                        <p className={styles.muted}>
                          Disponible para lectura; no aparece en búsqueda por
                          contenido hasta contar con OCR.
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className={styles.documentActions}>
                        <label>
                          Mover a
                          <select
                            aria-label={`Mover ${item.document.file?.filename ?? item.document.title} a carpeta`}
                            value={documentMoveTargets[item.documentId] ?? ""}
                            onChange={(event) =>
                              setDocumentMoveTargets((current) => ({
                                ...current,
                                [item.documentId]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Raíz</option>
                            {orderedFolders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folderPath(folder.id, folders)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          disabled={
                            busy ||
                            (documentMoveTargets[item.documentId] ?? "") ===
                              (item.folder?.id ?? "")
                          }
                          onClick={() => void moveDocument(item.documentId)}
                        >
                          Mover
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.emptyState}>
                {folderId
                  ? "Esta carpeta está vacía. Podés subir archivos o mover documentos acá."
                  : "Este espacio todavía no tiene documentos. Podés subir un PDF o crear una carpeta."}
              </p>
            )}
          </Card>

          {selectedWorkspace?.role === "ADMIN" && (
            <Card>
              <div>
                <p className={styles.eyebrow}>Copernic 2.0</p>
                <h2>Fuentes documentales</h2>
                <p className={styles.muted}>
                  Galilei usa la identidad del backend para leer carpetas UNC.
                  No se guardan credenciales de red.
                </p>
              </div>
              <form className={styles.inlineForm} onSubmit={(event) => void createSource(event)}>
                <label>
                  Nombre
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    maxLength={120}
                    placeholder="Sentencias 2026"
                  />
                </label>
                <label>
                  Ruta de red
                  <input
                    value={sourcePath}
                    onChange={(event) => {
                      setSourcePath(event.target.value);
                      setSourceTestStatus("");
                    }}
                    placeholder={String.raw`\\servidor\share\carpeta`}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </label>
                <button type="button" disabled={sourceBusy || !sourcePath.trim()} onClick={() => void testSourceAccess()}>
                  Probar acceso
                </button>
                <button className={styles.primaryButton} disabled={sourceBusy || !sourceName.trim() || sourceTestStatus !== "CONNECTED"}>
                  Guardar fuente
                </button>
                {sourceTestStatus && (
                  <span role="status" className={sourceTestStatus === "CONNECTED" ? styles.sourceConnected : styles.sourceError}>
                    {sourceTestStatus === "CONNECTED" ? "Conectada" : `Acceso: ${sourceTestStatus.replaceAll("_", " ").toLowerCase()}`}
                  </span>
                )}
              </form>
              {sources.length ? (
                <div className={styles.sourceList}>
                  {sources.map((source) => {
                    const run = source.lastRun;
                    const active = run && ["QUEUED", "RUNNING"].includes(run.status);
                    return (
                      <article className={styles.sourceRow} key={source.id}>
                        <div className={styles.sourceDetails}>
                          <strong>{source.name}</strong>
                          <code>{source.path}</code>
                          <small>
                            Estado: {source.status.replaceAll("_", " ").toLowerCase()} · {source.enabled ? "Activa" : "Pausada"} · {source.fileCount} registros
                          </small>
                          {run && (
                            <small>
                              Último run: {run.status.toLowerCase()} · {run.filesSeen} vistos · {run.indexedCount} disponibles · {run.newCount} nuevos · {run.modifiedCount} modificados · {run.unchangedCount} sin cambios · {run.missingCount} ausentes · {run.errorCount} errores · {run.hashCount} hashes · {run.totalDurationMs} ms
                            </small>
                          )}
                          {source.lastError && <small className={styles.sourceError}>{source.lastError}</small>}
                          {run?.errorMessage && <small className={styles.sourceError}>{run.errorMessage}</small>}
                        </div>
                        <div className={styles.sourceActions}>
                          <button disabled={sourceBusy || !source.enabled || Boolean(active)} onClick={() => void scanSource(source)}>
                            {active ? "Escaneando…" : "Escanear ahora"}
                          </button>
                          <button disabled={sourceBusy || Boolean(active)} onClick={() => void toggleSource(source)}>
                            {source.enabled ? "Pausar" : "Reanudar"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyState}>Todavía no hay fuentes en este espacio.</p>
              )}
            </Card>
          )}

          {selectedWorkspace?.role === "ADMIN" && (
            <Card>
              <div>
                <p className={styles.eyebrow}>Administración del espacio</p>
                <h2>Miembros y permisos</h2>
                <p className={styles.muted}>
                  Buscá una persona activa por nombre o correo. Los cambios
                  afectan únicamente este espacio.
                </p>
              </div>
              <form
                className={styles.memberSearch}
                onSubmit={(event) => void findMemberCandidates(event)}
              >
                <div className={styles.inlineForm}>
                  <label>
                    Buscar persona
                    <input
                      aria-label="Buscar persona por nombre o correo"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder="Nombre o correo (3 caracteres mínimo)"
                    />
                  </label>
                  <label>
                    Rol inicial
                    <select
                      aria-label="Rol para la nueva membresía"
                      value={memberRole}
                      onChange={(event) =>
                        setMemberRole(event.target.value as WorkspaceRole)
                      }
                    >
                      <option value="ADMIN">Administrador del espacio</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Consulta</option>
                    </select>
                  </label>
                  <button disabled={busy || memberQuery.trim().length < 3}>
                    Buscar
                  </button>
                </div>
              </form>
              {memberCandidates.length > 0 && (
                <div
                  className={styles.candidateList}
                  aria-label="Personas encontradas"
                >
                  {memberCandidates.map((candidate) => (
                    <div className={styles.candidate} key={candidate.id}>
                      <span>
                        {candidate.nombre} {candidate.apellido ?? ""} ·{" "}
                        {candidate.email}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void saveMember(candidate.id, memberRole)
                        }
                      >
                        Agregar como {ROLE_LABEL[memberRole]}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {memberQuery.length >= 3 && memberCandidates.length === 0 && (
                <p className={styles.muted}>
                  Sin resultados para esta búsqueda. Verificá el nombre o
                  correo.
                </p>
              )}
              <div>
                <h3>Personas asignadas</h3>
                {members.map((member) => (
                  <div className={styles.memberRow} key={member.userId}>
                    <div className={styles.memberIdentity}>
                      <strong>
                        {member.user.nombre} {member.user.apellido ?? ""}
                      </strong>
                      <small>
                        {member.user.email} ·{" "}
                        {member.active ? "Activo" : "Acceso desactivado"}
                      </small>
                    </div>
                    <div className={styles.memberActions}>
                      <label>
                        Permiso
                        <select
                          aria-label={`Permiso de ${member.user.email}`}
                          disabled={
                            !member.active || member.userId === user?.id
                          }
                          value={memberRoleDrafts[member.userId] ?? member.role}
                          onChange={(event) =>
                            setMemberRoleDrafts((current) => ({
                              ...current,
                              [member.userId]: event.target
                                .value as WorkspaceRole,
                            }))
                          }
                        >
                          <option value="ADMIN">
                            Administrador del espacio
                          </option>
                          <option value="EDITOR">Editor</option>
                          <option value="VIEWER">Consulta</option>
                        </select>
                      </label>
                      {(memberRoleDrafts[member.userId] ?? member.role) !==
                        member.role && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void saveMember(
                              member.userId,
                              memberRoleDrafts[member.userId] ?? member.role,
                              member.active,
                            )
                          }
                        >
                          Guardar permiso
                        </button>
                      )}
                      {member.active ? (
                        <button
                          className={styles.dangerButton}
                          disabled={busy || member.userId === user?.id}
                          onClick={() =>
                            setPendingConfirmation({
                              kind: "member",
                              id: String(member.userId),
                              label: `${member.user.nombre} ${member.user.apellido ?? ""}`,
                              active: false,
                            })
                          }
                        >
                          Desactivar acceso
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void saveMember(member.userId, member.role, true)
                          }
                        >
                          Reactivar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {selectedWorkspace?.role === "ADMIN" && activity.length > 0 && (
            <Card>
              <div>
                <p className={styles.eyebrow}>Registro reciente</p>
                <h2>Actividad del espacio</h2>
              </div>
              <ul className={styles.activityList}>
                {activity.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.nombre} {item.apellido ?? ""}
                    </strong>{" "}
                    ·{" "}
                    {item.descripcion ??
                      item.accion.replaceAll("_", " ").toLowerCase()}
                    <time dateTime={item.createdAt}>
                      {formatDate(item.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <div>
            <p className={styles.eyebrow}>Acceso al espacio</p>
            <h2>No tenés un espacio documental asignado</h2>
            <p className={styles.muted}>
              Contactá al administrador de Galilei para que te incorpore a un
              Juzgado, Sala o dependencia.
            </p>
          </div>
          {globalAdmin && (
            <p className={styles.muted}>
              Como administrador global podés crear espacios y gestionar su
              estado. Eso no habilita el acceso automático a sus documentos.
            </p>
          )}
        </Card>
      )}

      {globalAdmin && (
        <Card>
          <div className={styles.workspaceHeader}>
            <div>
              <p className={styles.eyebrow}>Administración global</p>
              <h2>Espacios documentales</h2>
              <p className={styles.muted}>
                Acá se administran las dependencias; el acceso a documentos
                sigue dependiendo de la membresía de cada espacio.
              </p>
            </div>
            <button
              className={styles.primaryButton}
              onClick={() => setShowCreateWorkspace((value) => !value)}
            >
              {showCreateWorkspace
                ? "Cerrar formulario"
                : "Crear espacio documental"}
            </button>
          </div>
          {showCreateWorkspace && (
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault();
                void createWorkspace();
              }}
            >
              <label>
                Código de dependencia
                <input
                  aria-label="Código de dependencia"
                  value={depCode}
                  onChange={(event) => setDepCode(event.target.value)}
                  placeholder="JUZGADO-CIVIL-64"
                  required
                />
              </label>
              <label>
                Nombre visible
                <input
                  aria-label="Nombre de dependencia"
                  value={depName}
                  onChange={(event) => setDepName(event.target.value)}
                  placeholder="Juzgado Civil 64"
                  required
                />
              </label>
              <label>
                Tipo
                <select
                  aria-label="Tipo de dependencia"
                  value={depType}
                  onChange={(event) => setDepType(event.target.value)}
                >
                  <option value="JUZGADO">Juzgado</option>
                  <option value="SALA">Sala</option>
                  <option value="SECRETARIA">Secretaría</option>
                  <option value="DEPENDENCIA">Dependencia</option>
                </select>
              </label>
              <button className={styles.primaryButton} disabled={busy}>
                Crear espacio
              </button>
            </form>
          )}
          {adminWorkspaces.length > 0 ? (
            <div className={styles.adminList}>
              {adminWorkspaces.map((workspace) => (
                <div className={styles.adminLine} key={workspace.id}>
                  <div className={styles.adminIdentity}>
                    <strong>
                      {workspace.name} · {typeLabel(workspace.type)}
                    </strong>
                    <small>
                      {workspace.code} ·{" "}
                      {workspace.active ? "Activo" : "Desactivado"}
                    </small>
                    <small>
                      Administran:{" "}
                      {workspace.administrators.length
                        ? workspace.administrators
                            .map(
                              (admin) =>
                                `${admin.nombre} ${admin.apellido ?? ""} (${admin.email})`,
                            )
                            .join(", ")
                        : "Sin administrador activo"}
                    </small>
                  </div>
                  <button
                    className={workspace.active ? styles.dangerButton : ""}
                    disabled={busy}
                    onClick={() =>
                      setPendingConfirmation({
                        kind: "workspace",
                        id: workspace.id,
                        label: workspace.name,
                        active: !workspace.active,
                      })
                    }
                  >
                    {workspace.active
                      ? "Desactivar espacio"
                      : "Reactivar espacio"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyState}>
              Todavía no hay espacios documentales registrados.
            </p>
          )}
        </Card>
      )}

      {pendingConfirmation && (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={styles.modal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
          >
            <h2 id="confirm-title">
              {pendingConfirmation.kind === "member"
                ? "Desactivar acceso"
                : pendingConfirmation.active
                  ? "Reactivar espacio"
                  : "Desactivar espacio"}
            </h2>
            <p id="confirm-description">
              {pendingConfirmation.kind === "member"
                ? `${pendingConfirmation.label} dejará de ingresar a este espacio. La membresía queda registrada para poder reactivarla.`
                : pendingConfirmation.active
                  ? `${pendingConfirmation.label} volverá a estar disponible para sus miembros activos.`
                  : `${pendingConfirmation.label} y sus documentos dejarán de estar disponibles para todos sus miembros.`}
            </p>
            <div className={styles.modalActions}>
              <button onClick={() => setPendingConfirmation(null)}>
                Cancelar
              </button>
              <button
                className={styles.dangerButton}
                disabled={busy}
                onClick={() => {
                  const confirmation = pendingConfirmation;
                  if (confirmation.kind === "member")
                    void saveMember(
                      Number(confirmation.id),
                      members.find(
                        (member) => member.userId === Number(confirmation.id),
                      )?.role ?? "VIEWER",
                      false,
                    );
                  else {
                    const target = adminWorkspaces.find(
                      (workspace) => workspace.id === confirmation.id,
                    );
                    if (target)
                      void setWorkspaceActive(target, confirmation.active);
                  }
                }}
              >
                {pendingConfirmation.active ? "Reactivar" : "Desactivar"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
