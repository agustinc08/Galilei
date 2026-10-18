const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const [links, statuses, sortRows] = await Promise.all([
    pool.query(`
      WITH private_links AS (
        SELECT d."id", d."status", count(wd."id")::int AS "linkCount",
               count(DISTINCT wd."workspaceId")::int AS "workspaceCount",
               count(wd."id") FILTER (WHERE wd."ownerUserId" IS NULL)::int AS "sharedLinkCount",
               count(wd."id") FILTER (WHERE wd."ownerUserId" IS NOT NULL)::int AS "personalLinkCount"
          FROM "CorpusDocument" d
          LEFT JOIN "WorkspaceDocument" wd ON wd."documentId" = d."id"
         WHERE d."documentScope" = 'PRIVATE_WORKSPACE'
         GROUP BY d."id", d."status"
      )
      SELECT count(*)::int AS "privateDocuments",
             count(*) FILTER (WHERE "linkCount" > 1)::int AS "documentsWithMultipleLinks",
             count(*) FILTER (WHERE "workspaceCount" > 1)::int AS "documentsInMultipleWorkspaces",
             count(*) FILTER (WHERE "sharedLinkCount" > 0 AND "status" NOT IN ('INDEXED', 'OCR_REQUIRED'))::int AS "sharedDocumentsExcludedByIndexStatus",
             count(*) FILTER (WHERE "personalLinkCount" > 0)::int AS "documentsWithPersonalLinks",
             count(*) FILTER (WHERE "linkCount" = 0)::int AS "privateDocumentsWithoutWorkspaceLink"
        FROM private_links
    `),
    pool.query(`
      SELECT d."status", count(*)::int AS "documents",
             count(DISTINCT wd."workspaceId")::int AS "workspaces"
        FROM "CorpusDocument" d
        LEFT JOIN "WorkspaceDocument" wd ON wd."documentId" = d."id"
       WHERE d."documentScope" = 'PRIVATE_WORKSPACE'
       GROUP BY d."status"
       ORDER BY d."status"
    `),
    pool.query(`
      SELECT "id", "sala", "numeroSentencia"
        FROM "Sentencia"
       WHERE "activo" = TRUE
    `),
  ]);
  const sortComparison = {};
  for (const [field, key] of [
    ['sala', 'sala'],
    ['numeroSentencia', 'numeroSentencia'],
  ]) {
    for (const direction of ['asc', 'desc']) {
      const multiplier = direction === 'asc' ? 1 : -1;
      const localeOrdered = [...sortRows.rows].sort((left, right) => {
        const primary = (left[key] ?? '').localeCompare(right[key] ?? '');
        return primary * multiplier || right.id - left.id;
      });
      const keywordOrdered = [...sortRows.rows].sort((left, right) => {
        const leftValue = left[key];
        const rightValue = right[key];
        let primary = 0;
        if (leftValue == null && rightValue != null) primary = -1;
        else if (leftValue != null && rightValue == null) primary = 1;
        else if (leftValue != null && rightValue != null)
          primary = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return primary * multiplier || right.id - left.id;
      });
      const firstMismatch = localeOrdered.findIndex(
        (row, index) => row.id !== keywordOrdered[index]?.id,
      );
      sortComparison[`${field}-${direction}`] = {
        rows: sortRows.rows.length,
        nullValues: sortRows.rows.filter((row) => row[key] == null).length,
        emptyValues: sortRows.rows.filter((row) => row[key] === '').length,
        exactOrder: firstMismatch === -1,
        firstMismatchPosition: firstMismatch === -1 ? null : firstMismatch + 1,
        localeFirstId: localeOrdered[0]?.id ?? null,
        keywordFirstId: keywordOrdered[0]?.id ?? null,
      };
    }
  }
  process.stdout.write(
    `${JSON.stringify({ readOnly: true, links: links.rows[0], statuses: statuses.rows, sortComparison }, null, 2)}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(
      `${error?.code ?? error?.message ?? 'AUDIT_FAILED'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
