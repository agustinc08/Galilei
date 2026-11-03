export type WorkspaceFolderFile = {
  file: File;
  relativePath: string;
  displayPath: string;
  folderSegments: string[];
};

export type WorkspaceFolderIssue = {
  name: string;
  reason: string;
};

export type WorkspaceFolderSelection = {
  files: WorkspaceFolderFile[];
  omitted: WorkspaceFolderIssue[];
  errors: WorkspaceFolderIssue[];
  rootFolders: string[];
  folderCount: number;
  totalBytes: number;
};

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".txt",
  ".rtf",
  ".doc",
  ".docx",
  ".odt",
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const INVALID_WINDOWS_NAME = /[<>:"|?*]/u;

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function validPathSegment(segment: string, maxLength: number) {
  return (
    segment.length > 0 &&
    segment.length <= maxLength &&
    segment !== "." &&
    segment !== ".." &&
    !hasControlCharacters(segment) &&
    !INVALID_WINDOWS_NAME.test(segment) &&
    !/[. ]$/u.test(segment) &&
    !WINDOWS_RESERVED_NAME.test(segment)
  );
}

export function inspectWorkspaceFolderFiles(
  files: File[],
): WorkspaceFolderSelection {
  const accepted: WorkspaceFolderFile[] = [];
  const omitted: WorkspaceFolderIssue[] = [];
  const errors: WorkspaceFolderIssue[] = [];

  for (const file of files) {
    const rawPath = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    const normalizedPath = rawPath?.replaceAll("\\", "/") ?? "";
    const segments = normalizedPath.split("/");
    const displayPath = normalizedPath.replaceAll("/", " / ") || file.name;
    const pathIsSafe =
      Boolean(rawPath) &&
      !normalizedPath.startsWith("/") &&
      !/^[a-z]:/iu.test(normalizedPath) &&
      segments.length >= 2 &&
      segments.at(-1) === file.name &&
      segments.slice(0, -1).every((segment) =>
        validPathSegment(segment, 100),
      ) &&
      validPathSegment(file.name, 255);

    if (!pathIsSafe) {
      omitted.push({ name: displayPath, reason: "Ruta o nombre no válido" });
      continue;
    }

    const extension = file.name.includes(".")
      ? `.${file.name.split(".").at(-1)?.toLowerCase()}`
      : "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      omitted.push({ name: displayPath, reason: "Formato no admitido" });
      continue;
    }
    if (file.size === 0) {
      errors.push({ name: displayPath, reason: "El archivo está vacío" });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push({
        name: displayPath,
        reason: "Supera el límite de 20 MiB por archivo",
      });
      continue;
    }

    accepted.push({
      file,
      relativePath: normalizedPath,
      displayPath,
      folderSegments: segments.slice(0, -1),
    });
  }

  const folderPaths = new Set<string>();
  const rootFolders = new Set<string>();
  for (const entry of accepted) {
    rootFolders.add(entry.folderSegments[0]);
    for (let depth = 1; depth <= entry.folderSegments.length; depth += 1) {
      folderPaths.add(entry.folderSegments.slice(0, depth).join("/").toLocaleLowerCase("es"));
    }
  }

  return {
    files: accepted,
    omitted,
    errors,
    rootFolders: [...rootFolders],
    folderCount: folderPaths.size,
    totalBytes: accepted.reduce((total, entry) => total + entry.file.size, 0),
  };
}
