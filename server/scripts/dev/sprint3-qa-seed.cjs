'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const repositoryRoot = path.resolve(__dirname, '../../..');
const evidenceRoot = path.join(
  repositoryRoot,
  '_recovery-work',
  'galilei-structured-citations-suite3',
);
const storageRoot = path.join(evidenceRoot, 'qa-storage');
const makeId = () => `c${randomBytes(12).toString('hex')}`;

function assertIsolatedQaTarget() {
  const rawUrl = process.env.DATABASE_URL;
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error('SPRINT3_QA_DATABASE_TARGET_REJECTED');
  }
  if (
    process.env.BJC_SPRINT3_QA_SEED !== 'true' ||
    process.env.BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEPLOYMENT_ENV !== 'development' ||
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55434' ||
    target.pathname !== '/buscador_juridico_civil_deepqa' ||
    target.username !== 'bjc_dev' ||
    !target.password ||
    target.search ||
    target.hash
  ) {
    throw new Error('SPRINT3_QA_DATABASE_TARGET_REJECTED');
  }
}

function makePdf(pageTexts) {
  const pageCount = pageTexts.length;
  const escape = (value) => value
    .replace(/\\/gu, '\\\\')
    .replace(/\(/gu, '\\(')
    .replace(/\)/gu, '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => {
      const contentId = pageCount + 4 + index;
      const fontId = pageCount + 3;
      return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageTexts.map((text) => {
      const escaped = escape(text);
      const stream = `BT /F1 18 Tf 72 700 Td (${escaped}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let pdf = '%PDF-1.4\n% Sprint 3 synthetic QA fixture\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function main() {
  assertIsolatedQaTarget();
  fs.mkdirSync(storageRoot, { recursive: true });
  const suffix = randomBytes(5).toString('hex');
  const slug = `suite3-qa-${suffix}`;
  const email = `suite3-reviewer-${suffix}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  const pageTexts = [
    'AUTOS Y VISTOS: Fallo sintetico para la prueba de navegacion y citas.',
    'CONSIDERANDO I: Se cita Expte. CIV 900002/2024 y Fallos: 315:2834.',
    'RESUELVE: Notifiquese. Cierre del documento de prueba.',
  ];
  const pdf = makePdf(pageTexts);
  const checksum = createHash('sha256').update(pdf).digest('hex');
  const storageKey = `suite3-qa/${slug}.pdf`;
  const physicalPath = path.join(storageRoot, storageKey);
  const credentialsPath = path.join(evidenceRoot, 'qa-auth.json');
  const fixturePath = path.join(evidenceRoot, 'qa-fixture.json');
  fs.mkdirSync(path.dirname(physicalPath), { recursive: true });
  if (fs.existsSync(credentialsPath) || fs.existsSync(fixturePath)) {
    throw new Error('SPRINT3_QA_FIXTURE_ALREADY_EXISTS');
  }
  fs.writeFileSync(physicalPath, pdf, { flag: 'wx' });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "Sentencia") AS sentences,
        (SELECT count(*)::int FROM "CorpusDocument") AS corpus_documents,
        (SELECT count(*)::int FROM "Usuario") AS users
    `);
    if (
      counts.rows[0].sentences !== 0 ||
      counts.rows[0].corpus_documents !== 0 ||
      counts.rows[0].users !== 0
    ) {
      throw new Error('SPRINT3_QA_DATABASE_NOT_EMPTY');
    }

    const role = await client.query(
      `INSERT INTO "Rol" ("nombre", "descripcion", "updatedAt")
       VALUES ('JURISPRUDENCIA', 'Rol sintetico Sprint 3 QA', now())
       ON CONFLICT ("nombre") DO UPDATE SET "descripcion" = EXCLUDED."descripcion", "updatedAt" = now()
       RETURNING "id"`,
    );
    const passwordHash = await bcrypt.hash(password, 10);
    const reviewer = await client.query(
      `INSERT INTO "Usuario" ("nombre", "apellido", "email", "passwordHash", "activo", "rolId", "updatedAt")
       VALUES ('Sprint 3', 'QA Reviewer', $1, $2, true, $3, now())
       RETURNING "id"`,
      [email, passwordHash, role.rows[0].id],
    );

    const target = await client.query(
      `INSERT INTO "Sentencia" ("numeroSentencia", "tipoFallo", "sala", "fecha", "expediente", "tribunalOrigen", "estadoCarga", "publicado", "publishedAt", "activo", "slugPublico", "caratula", "anio", "updatedAt")
       VALUES ('S3-TARGET-1', 'Sentencia', 'H', '2024-02-01', '900002/2024', 'Cámara Nacional de Apelaciones en lo Civil', 'PUBLICADO', true, now(), true, $1, 'Destino sintetico de cita', 2024, now())
       RETURNING "id"`,
      [`${slug}-target`],
    );
    const privateTarget = await client.query(
      `INSERT INTO "Sentencia" ("numeroSentencia", "tipoFallo", "sala", "fecha", "expediente", "tribunalOrigen", "estadoCarga", "publicado", "activo", "slugPublico", "caratula", "anio", "updatedAt")
       VALUES ('S3-TARGET-PRIVATE', 'Sentencia', 'H', '2024-03-01', '900003/2024', 'Cámara Nacional de Apelaciones en lo Civil', 'BORRADOR', false, true, $1, 'Destino privado sintetico', 2024, now())
       RETURNING "id"`,
      [`${slug}-private-target`],
    );
    const source = await client.query(
      `INSERT INTO "Sentencia" ("numeroSentencia", "tipoFallo", "sala", "fecha", "expediente", "tribunalOrigen", "estadoCarga", "publicado", "publishedAt", "activo", "slugPublico", "caratula", "actor", "demandado", "anio", "tienePdf", "updatedAt")
       VALUES ('S3-SOURCE-1', 'Sentencia', 'H', '2026-01-15', '900001/2026', 'Cámara Nacional de Apelaciones en lo Civil', 'PUBLICADO', true, now(), true, $1, 'Fallo sintetico de navegacion', 'Parte actora sintetica', 'Parte demandada sintetica', 2026, true, now())
       RETURNING "id"`,
      [slug],
    );
    const sourceSentenceId = source.rows[0].id;
    await client.query(
      `INSERT INTO "ArchivoPdf" ("nombreArchivo", "nombreOriginal", "rutaArchivo", "mimeType", "tamanioBytes", "sentenciaId", "updatedAt")
       VALUES ($1, $1, $2, 'application/pdf', $3, $4, now())`,
      [`${slug}.pdf`, physicalPath, pdf.length, sourceSentenceId],
    );

    const corpusDocument = await client.query(
      `INSERT INTO "CorpusDocument" ("id", "documentType", "title", "subtitle", "jurisdiction", "court", "chamber", "caseNumber", "decisionDate", "visibility", "documentScope", "status", "editorialStatus", "anonymizationStatus", "searchText", "updatedAt")
       VALUES ($1, 'JUDGMENT', 'Fallo sintetico Sprint 3', 'Navegacion y cita', 'CIVIL', 'Cámara Nacional de Apelaciones en lo Civil', 'H', '900001/2026', '2026-01-15', 'PUBLIC', 'GENERAL', 'READY', 'REVIEWED', 'ANONYMIZED', $2, now())
       RETURNING "id"`,
      [makeId(), pageTexts.join('\n')],
    );
    const corpusId = corpusDocument.rows[0].id;
    const corpusFile = await client.query(
      `INSERT INTO "CorpusDocumentFile" ("id", "documentId", "storageProvider", "storageKey", "originalFilename", "mimeType", "sizeBytes", "sha256", "pageCount")
       VALUES ($1, $2, 'LOCAL_DEV', $3, $4, 'application/pdf', $5, $6, $7)
       RETURNING "id"`,
      [makeId(), corpusId, storageKey, `${slug}.pdf`, pdf.length, checksum, pageTexts.length],
    );
    const extraction = await client.query(
      `INSERT INTO "CorpusExtraction" ("id", "documentId", "fileId", "extractor", "extractorVersion", "status", "text", "provenance")
       VALUES ($1, $2, $3, 'sprint3-qa-synthetic', '1', 'TEXT_EXTRACTED', $4, $5::jsonb)
       RETURNING "id"`,
      [makeId(), corpusId, corpusFile.rows[0].id, pageTexts.join('\n'), JSON.stringify({ synthetic: true, source: 'suite3-qa-seed' })],
    );
    await client.query(
      `INSERT INTO "CorpusDocumentPage" ("id", "extractionId", "pageNumber", "text", "textKind", "processingStatus")
       VALUES ($1, $2, 1, $3, 'NATIVE', 'TEXT_NATIVE'), ($4, $2, 2, $5, 'NATIVE', 'TEXT_NATIVE'), ($6, $2, 3, $7, 'NATIVE', 'TEXT_NATIVE')`,
      [makeId(), extraction.rows[0].id, pageTexts[0], makeId(), pageTexts[1], makeId(), pageTexts[2]],
    );
    await client.query(
      `UPDATE "CorpusDocument" SET "latestExtractionId" = $1, "updatedAt" = now() WHERE "id" = $2`,
      [extraction.rows[0].id, corpusId],
    );
    await client.query(
      `INSERT INTO "CorpusDocumentLink" ("id", "documentId", "targetDomain", "targetType", "targetId", "relationship")
       VALUES ($1, $2, 'JURISPRUDENCIA', 'SENTENCIA', $3, 'ASSOCIATED_WITH')`,
      [makeId(), corpusId, String(sourceSentenceId)],
    );
    await client.query('COMMIT');

    fs.writeFileSync(
      credentialsPath,
      `${JSON.stringify({ email, password }, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    fs.writeFileSync(
      fixturePath,
      `${JSON.stringify({
        slug,
        sourceSentenceId,
        targetSentenceId: target.rows[0].id,
        privateTargetSentenceId: privateTarget.rows[0].id,
        corpusDocumentId: corpusId,
        extractionId: extraction.rows[0].id,
        reviewerId: reviewer.rows[0].id,
        pdfPath: physicalPath,
        pageCount: pageTexts.length,
        checksum,
      }, null, 2)}\n`,
      { flag: 'wx' },
    );
    console.log(JSON.stringify({
      status: 'SPRINT3_QA_FIXTURE_CREATED',
      slug,
      sourceSentenceId,
      targetSentenceId: target.rows[0].id,
      privateTargetSentenceId: privateTarget.rows[0].id,
      corpusDocumentId: corpusId,
      pageCount: pageTexts.length,
      pdfBytes: pdf.length,
      checksum,
      credentialsSavedOutsideGit: true,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fs.rmSync(physicalPath, { force: true });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`SPRINT3_QA_SEED=FAIL; ${error?.message ?? 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
});
