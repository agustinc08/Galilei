import { existsSync } from 'fs';

export type ArchivoPdfLike = {
  id: number;
  rutaArchivo: string | null;
};

export type PdfRealInfo = {
  disponible: boolean;
  cantidad: number;
  archivoPdfId: number | null;
  archivos: ArchivoPdfLike[];
};

export function archivoPdfEsReal(archivo?: ArchivoPdfLike | null) {
  return Boolean(
    archivo?.rutaArchivo?.trim() && existsSync(archivo.rutaArchivo),
  );
}

export function obtenerPdfsReales<T extends ArchivoPdfLike>(archivos: T[]) {
  return archivos.filter((archivo) => archivoPdfEsReal(archivo));
}

export function sentenciaTienePdfReal<T extends ArchivoPdfLike>(
  archivos: T[],
): PdfRealInfo {
  const reales = obtenerPdfsReales(archivos);

  return {
    disponible: reales.length > 0,
    cantidad: reales.length,
    archivoPdfId: reales[0]?.id ?? null,
    archivos: reales,
  };
}
