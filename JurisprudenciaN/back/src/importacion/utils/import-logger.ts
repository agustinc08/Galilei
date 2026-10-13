import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join, resolve } from 'path';
import { ImportOptions, ImportStats } from '../types/importacion-options.type';

type Level = 'INFO' | 'WARN' | 'ERROR';

export class ImportLogger {
  readonly logFilePath: string;
  readonly summaryFilePath: string;
  private readonly stream: WriteStream;

  constructor(private readonly options: ImportOptions) {
    const logsDir = resolve(process.cwd(), 'logs', 'importacion');
    mkdirSync(logsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = options.logPrefix ?? 'import-sqlite';
    const filename = `${prefix}-${timestamp}.log`;
    this.logFilePath = join(logsDir, filename);
    this.summaryFilePath = join(logsDir, `import-summary-${timestamp}.json`);
    this.stream = createWriteStream(this.logFilePath, { flags: 'a' });

    this.info(
      `Inicio de importacion (${options.dryRun ? 'dry-run' : 'real'}) modo=${options.only}`,
    );
  }

  info(message: string) {
    this.write('INFO', message);
  }

  warn(message: string) {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown) {
    const detail =
      error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : '';
    this.write('ERROR', detail ? `${message}\n${detail}` : message);
  }

  summaryPayload(stats: ImportStats) {
    return {
      dryRun: this.options.dryRun,
      mode: this.options.only,
      sqlitePath: this.options.sqlitePath,
      pdfBasePath: this.options.pdfBasePath ?? null,
      batchSize: this.options.batchSize,
      generatedAt: new Date().toISOString(),
      stats,
      logFilePath: this.logFilePath,
      summaryFilePath: this.summaryFilePath,
    };
  }

  summary(stats: ImportStats) {
    const lines = [
      'Resumen de importacion:',
      `- sentencias leidas: ${stats.sentenciasRead}`,
      `- sentencias creadas: ${stats.sentenciasCreated}`,
      `- sentencias actualizadas: ${stats.sentenciasUpdated}`,
      `- sentencias omitidas: ${stats.sentenciasSkipped}`,
      `- sumarios leidos: ${stats.sumariosRead}`,
      `- sumarios creados: ${stats.sumariosCreated}`,
      `- sumarios actualizados: ${stats.sumariosUpdated}`,
      `- sumarios omitidos: ${stats.sumariosSkipped}`,
      `- PDFs detectados: ${stats.pdfsDetected}`,
      `- PDFs matcheados: ${stats.pdfsMatched}`,
      `- PDFs sin match: ${stats.pdfsUnmatched}`,
      `- PDFs huerfanos: ${stats.pdfsOrphans}`,
      `- PDFs asociados: ${stats.pdfsAssociated}`,
      `- PDFs copiados: ${stats.pdfsCopied}`,
      `- PDFs omitidos: ${stats.pdfsSkipped}`,
      `- errores: ${stats.errors}`,
      `- advertencias: ${stats.warnings}`,
      `- log: ${this.logFilePath}`,
      `- summary: ${this.summaryFilePath}`,
    ];

    for (const line of lines) {
      this.info(line);
    }

    this.stream.write(
      `${JSON.stringify(this.summaryPayload(stats), null, 2)}\n`,
    );
  }

  close() {
    return new Promise<void>((resolvePromise) => {
      this.stream.end(() => resolvePromise());
    });
  }

  private write(level: Level, message: string) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    console.log(line);
    this.stream.write(`${line}\n`);
  }
}
