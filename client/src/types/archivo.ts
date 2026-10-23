export type ArchivoPdf = {
  id: number;
  nombreArchivo: string;
  nombreOriginal?: string | null;
  rutaArchivo: string;
  legacyPath?: string | null;
  mimeType?: string | null;
  tamanioBytes?: number | null;
  sentenciaId: number;
  createdAt: string;
  updatedAt: string;
};
