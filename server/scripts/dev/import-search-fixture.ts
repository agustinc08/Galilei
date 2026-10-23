import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import {
  buildSentenciaSearchData,
  buildSumarioSearchData,
} from '../../src/busqueda/utils/search-normalizer';

type LegacySentencia = {
  id_sentencia: number;
  codigo_sentencia: string | number | null;
  tipo_fallo: string | null;
  sala: string | null;
  fecha: string | null;
  objeto: string | null;
  actor: string | null;
  demandado: string | null;
  magistrados: string | null;
  tribunal_origen: string | null;
  nro_expte: string | null;
  activo: number | null;
};

type LegacySumario = {
  id_sumario: number;
  id_sentencia: number;
  numero_sumario: string | number | null;
  tema: string | null;
  texto_sumario: string | null;
  resumen: string | null;
  publicado: number | null;
  activo: number | null;
};

const root = resolve(__dirname, '../../../');
const source = resolve(
  root,
  '_legacy-audit-work/extracted/jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite',
);
const batchSize = 250;
const fixtureTimestamp = new Date('2000-01-01T00:00:00.000Z');

function safeDate(value: string | null): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asText(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result.length ? result : null;
}

function asBoolean(value: number | null | undefined): boolean {
  return value === 1;
}

function legacyId(table: 'tb_sentencias' | 'tb_sumarios', id: number) {
  return `sqlite:jurisp_6/db/jurisprudencia_db.sqlite#${table}/${id}`;
}

async function insertRows(
  client: Client,
  table: 'Sentencia' | 'Sumario',
  columns: string[],
  rows: unknown[][],
  updateColumns: string[],
) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flat();
    const placeholders = batch.map((row, rowIndex) => {
      const start = rowIndex * columns.length;
      return `(${columns.map((_, colIndex) => `$${start + colIndex + 1}`).join(',')})`;
    });
    const assignments = updateColumns.map((column) => `"${column}"=EXCLUDED."${column}"`).join(',');
    const sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT ("legacyId") DO UPDATE SET ${assignments}`;
    await client.query(sql, values);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');
  const sqlite = await open({
    filename: `file:${source.replace(/\\/gu, '/')}?mode=ro&immutable=1`,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI,
  });
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let transactionStarted = false;
  try {
    await sqlite.get('PRAGMA query_only = ON');
    const orphan = await sqlite.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM tb_sumarios s LEFT JOIN tb_sentencias t ON t.id_sentencia=s.id_sentencia WHERE t.id_sentencia IS NULL',
    );
    const sentenciaSource = await sqlite.all<LegacySentencia[]>(
      'SELECT id_sentencia, codigo_sentencia, tipo_fallo, sala, fecha, objeto, actor, demandado, magistrados, tribunal_origen, nro_expte, activo FROM tb_sentencias ORDER BY id_sentencia',
    );
    // The INNER JOIN rule matches the legacy search relation and excludes one orphaned source row.
    const sumarioSource = await sqlite.all<LegacySumario[]>(
      `SELECT s.id_sumario, s.id_sentencia, s.numero_sumario, s.tema, s.texto_sumario, s.resumen, s.publicado, s.activo
       FROM tb_sumarios s INNER JOIN tb_sentencias t ON t.id_sentencia=s.id_sentencia
       ORDER BY s.id_sumario`,
    );

    const checksum = createHash('sha256');
    const sentenciaColumns = [
      'id', 'legacyId', 'numeroSentencia', 'tipoFallo', 'sala', 'fecha', 'expediente',
      'tribunalOrigen', 'actor', 'demandado', 'objeto', 'magistrados', 'publicado', 'activo',
      'resumenIa', 'textoBusqueda', 'textoBusquedaNormalizado', 'caratula', 'anio', 'tienePdf',
      'createdAt', 'updatedAt',
    ];
    const sentenciaRows = sentenciaSource.map((row) => {
      const numeroSentencia = asText(row.codigo_sentencia);
      const fecha = safeDate(row.fecha);
      const data = buildSentenciaSearchData({
        numeroSentencia,
        tipoFallo: row.tipo_fallo,
        sala: row.sala,
        expediente: row.nro_expte,
        tribunalOrigen: row.tribunal_origen,
        actor: row.actor,
        demandado: row.demandado,
        objeto: row.objeto,
        magistrados: row.magistrados,
        fecha,
      });
      const values = [
        row.id_sentencia,
        legacyId('tb_sentencias', row.id_sentencia),
        numeroSentencia,
        asText(row.tipo_fallo),
        asText(row.sala),
        fecha,
        asText(row.nro_expte),
        asText(row.tribunal_origen),
        asText(row.actor),
        asText(row.demandado),
        asText(row.objeto),
        asText(row.magistrados),
        false, // Legacy rows are not asserted to be editorially published by this fixture.
        asBoolean(row.activo),
        null,
        data.textoBusqueda,
        data.textoBusquedaNormalizado,
        data.caratula,
        data.anio,
        false,
        fixtureTimestamp,
        fixtureTimestamp,
      ];
      checksum.update(JSON.stringify(values));
      checksum.update('\n');
      return values;
    });

    const sumarioColumns = [
      'id', 'legacyId', 'numeroSumario', 'tema', 'texto', 'resumenBusqueda',
      'textoBusqueda', 'textoBusquedaNormalizado', 'publicado', 'activo', 'sentenciaId',
      'createdAt', 'updatedAt',
    ];
    const sumarioRows = sumarioSource.map((row) => {
      const numeroSumario = asText(row.numero_sumario);
      const tema = asText(row.tema);
      // Keep the raw legacy summary verbatim: boundary spaces are part of the legacy LIKE contract.
      const legacyResumen = typeof row.resumen === 'string' && row.resumen.trim() ? row.resumen : null;
      const texto = asText(row.texto_sumario) ?? legacyResumen ?? tema ?? '';
      const data = buildSumarioSearchData({ numeroSumario, tema, texto, resumenBusqueda: legacyResumen });
      const values = [
        row.id_sumario,
        legacyId('tb_sumarios', row.id_sumario),
        numeroSumario,
        tema,
        texto,
        legacyResumen,
        data.textoBusqueda,
        data.textoBusquedaNormalizado,
        asBoolean(row.publicado),
        asBoolean(row.activo),
        row.id_sentencia,
        fixtureTimestamp,
        fixtureTimestamp,
      ];
      checksum.update(JSON.stringify(values));
      checksum.update('\n');
      return values;
    });

    await client.connect();
    const identity = await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port,
             current_setting('server_version_num')::integer AS version
    `);
    const target = identity.rows[0];
    if (target.database !== 'buscador_juridico_civil_dev' || target.role !== 'bjc_dev' ||
        target.address?.split('/')[0] !== '127.0.0.1' || target.port !== 55432 ||
        target.version < 160000 || target.version >= 170000) {
      throw new Error('Connected database identity failed the DEV-only write guard.');
    }

    await client.query('BEGIN');
    transactionStarted = true;
    await insertRows(client, 'Sentencia', sentenciaColumns, sentenciaRows, sentenciaColumns.slice(2));
    await insertRows(client, 'Sumario', sumarioColumns, sumarioRows, sumarioColumns.slice(2));
    await client.query(`SELECT setval(pg_get_serial_sequence('"Sentencia"','id'), GREATEST(COALESCE(MAX(id),1),1), COUNT(*) > 0) FROM "Sentencia"`);
    await client.query(`SELECT setval(pg_get_serial_sequence('"Sumario"','id'), GREATEST(COALESCE(MAX(id),1),1), COUNT(*) > 0) FROM "Sumario"`);
    await client.query('COMMIT');
    transactionStarted = false;

    console.log(`FIXTURE_IMPORT=PASS; source=jurisp_6/db/jurisprudencia_db.sqlite; readOnly=true; queryOnly=true; tables=tb_sentencias,tb_sumarios; excluded=tb_microisis; sentencias=${sentenciaRows.length}; sumarios=${sumarioRows.length}; orphanSumariosSkipped=${orphan?.count ?? 0}; checksum=${checksum.digest('hex')}`);
  } finally {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
    await sqlite.close();
  }
}

main().catch((error) => {
  console.error(`FIXTURE_IMPORT=FAIL; ${error.message}`);
  process.exitCode = 1;
});
