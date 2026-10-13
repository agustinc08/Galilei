export type ImportOnly = 'all' | 'sentencias' | 'sumarios' | 'pdfs';

export type ImportOptions = {
  dryRun: boolean;
  only: ImportOnly;
  sqlitePath: string;
  pdfBasePath?: string;
  batchSize: number;
  logPrefix?: 'import-sqlite' | 'import-pdfs' | 'import-validate';
};

export type ImportStats = {
  sentenciasRead: number;
  sentenciasCreated: number;
  sentenciasUpdated: number;
  sentenciasSkipped: number;
  sumariosRead: number;
  sumariosCreated: number;
  sumariosUpdated: number;
  sumariosSkipped: number;
  pdfsDetected: number;
  pdfsMatched: number;
  pdfsUnmatched: number;
  pdfsOrphans: number;
  pdfsCopied: number;
  pdfsSkipped: number;
  pdfsAssociated: number;
  errors: number;
  warnings: number;
  estrategiasPdf: Record<string, number>;
};

export const createImportStats = (): ImportStats => ({
  sentenciasRead: 0,
  sentenciasCreated: 0,
  sentenciasUpdated: 0,
  sentenciasSkipped: 0,
  sumariosRead: 0,
  sumariosCreated: 0,
  sumariosUpdated: 0,
  sumariosSkipped: 0,
  pdfsDetected: 0,
  pdfsMatched: 0,
  pdfsUnmatched: 0,
  pdfsOrphans: 0,
  pdfsCopied: 0,
  pdfsSkipped: 0,
  pdfsAssociated: 0,
  errors: 0,
  warnings: 0,
  estrategiasPdf: {},
});
