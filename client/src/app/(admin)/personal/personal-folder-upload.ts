export type PersonalFolderFile = {
  file: File;
  relativeFolders: string[];
  displayPath: string;
};

export type PersonalFolderOmission = {
  name: string;
  reason: string;
};

export type PersonalFolderSelection = {
  files: PersonalFolderFile[];
  omitted: PersonalFolderOmission[];
  errors: PersonalFolderOmission[];
};

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SYSTEM_FILES = new Set([
  "desktop.ini",
  "thumbs.db",
  "ehthumbs.db",
  ".ds_store",
]);

export function inspectPersonalFolderFiles(files: File[]): PersonalFolderSelection {
  const accepted: PersonalFolderFile[] = [];
  const omitted: PersonalFolderOmission[] = [];
  const errors: PersonalFolderOmission[] = [];

  for (const file of files) {
    const rawPath = file.webkitRelativePath || file.name;
    const normalizedPath = rawPath.replaceAll("\\", "/");
    const segments = normalizedPath.split("/");
    const extension = file.name.includes(".")
      ? `.${file.name.split(".").at(-1)?.toLowerCase()}`
      : "";
    const displayPath = segments.slice(1).join(" / ") || file.name;

    if (
      !rawPath ||
      normalizedPath.startsWith("/") ||
      /^[a-z]:/iu.test(normalizedPath) ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      segments.at(-1) !== file.name ||
      segments.some((segment) =>
        Array.from(segment).some((character) => {
          const code = character.charCodeAt(0);
          return code < 0x20 || code === 0x7f;
        }),
      )
    ) {
      omitted.push({ name: displayPath, reason: "Ruta no válida" });
      continue;
    }

    if (
      segments.some((segment) => segment.startsWith(".")) ||
      SYSTEM_FILES.has(file.name.toLowerCase()) ||
      file.name.startsWith("~$")
    ) {
      omitted.push({ name: displayPath, reason: "Archivo oculto o temporal" });
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      omitted.push({ name: displayPath, reason: "Formato no admitido" });
      continue;
    }

    if (file.size === 0) {
      errors.push({ name: displayPath, reason: "El archivo está vacío" });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push({ name: displayPath, reason: "Supera el límite de 20 MiB por archivo" });
      continue;
    }

    const relativeFolders = segments.length > 1 ? segments.slice(1, -1) : [];
    if (relativeFolders.some((folder) => folder.length > 100)) {
      omitted.push({ name: displayPath, reason: "Nombre de carpeta demasiado largo" });
      continue;
    }

    accepted.push({ file, relativeFolders, displayPath });
  }

  return { files: accepted, omitted, errors };
}
