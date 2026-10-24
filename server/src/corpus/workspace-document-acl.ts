import {
  Prisma,
  type WorkspaceVisibilityScope,
} from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type WorkspaceDocumentAclScope =
  | { kind: 'WORKSPACE'; workspaceId: string; userId: number }
  | { kind: 'PERSONAL'; userId: number };

/** Return only folders whose entire inherited path is readable by this user. */
export async function readableFolderIds(
  prisma: PrismaService,
  scope: WorkspaceDocumentAclScope,
): Promise<string[]> {
  const targetPredicate =
    scope.kind === 'WORKSPACE'
      ? Prisma.sql`folder."workspaceId" = ${scope.workspaceId} AND folder."ownerUserId" IS NULL`
      : Prisma.sql`folder."workspaceId" IS NULL AND folder."ownerUserId" = ${scope.userId}`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE folder_chain AS (
      SELECT folder."id" AS "targetId", folder."id" AS "ancestorId",
             folder."parentId", folder."workspaceId", folder."ownerUserId",
             folder."visibilityScope", folder."createdById", 0 AS depth
        FROM "WorkspaceFolder" folder
       WHERE ${targetPredicate}
      UNION ALL
      SELECT chain."targetId", parent."id", parent."parentId",
             parent."workspaceId", parent."ownerUserId",
             parent."visibilityScope", parent."createdById", chain.depth + 1
        FROM folder_chain chain
        JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
       WHERE parent."workspaceId" IS NOT DISTINCT FROM chain."workspaceId"
         AND parent."ownerUserId" IS NOT DISTINCT FROM chain."ownerUserId"
    )
    SELECT chain."targetId" AS id
      FROM folder_chain chain
     GROUP BY chain."targetId"
    HAVING bool_and(
      CASE chain."visibilityScope"::text
        WHEN 'PERSONAL' THEN chain."ownerUserId" = ${scope.userId}
        WHEN 'RESTRICTED' THEN EXISTS (
          SELECT 1 FROM "WorkspaceMembership" membership
           WHERE membership."workspaceId" = chain."workspaceId"
             AND membership."userId" = ${scope.userId}
             AND membership."active" = TRUE
             AND (
               membership."role" = 'ADMIN'
               OR chain."createdById" = membership."userId"
               OR EXISTS (
                 SELECT 1 FROM "WorkspaceFolderGrant" grant_row
                  WHERE grant_row."folderId" = chain."ancestorId"
                    AND grant_row."membershipId" = membership."id"
               )
             )
        )
        ELSE TRUE
      END
    )
  `);
  return rows.map((row) => row.id);
}

/** Live DB check shared by Viewer, matches and download. No ACL cache is used. */
export async function canReadWorkspaceDocument(
  prisma: PrismaService,
  documentId: string,
  scope: WorkspaceDocumentAclScope,
): Promise<boolean> {
  const associationPredicate =
    scope.kind === 'WORKSPACE'
      ? Prisma.sql`
          association."workspaceId" = ${scope.workspaceId}
          AND association."ownerUserId" IS NULL
          AND EXISTS (
            SELECT 1 FROM "WorkspaceMembership" membership
            JOIN "DocumentWorkspace" workspace ON workspace."id" = membership."workspaceId"
            WHERE membership."workspaceId" = association."workspaceId"
              AND membership."userId" = ${scope.userId}
              AND membership."active" = TRUE
              AND workspace."active" = TRUE
          )`
      : Prisma.sql`
          association."workspaceId" IS NULL
          AND association."ownerUserId" = ${scope.userId}`;
  const rows = await prisma.$queryRaw<Array<{ allowed: boolean }>>(Prisma.sql`
    WITH RECURSIVE authorized_association AS (
      SELECT association."id", association."workspaceId", association."ownerUserId",
             association."folderId"
        FROM "WorkspaceDocument" association
       WHERE association."documentId" = ${documentId}
         AND ${associationPredicate}
    ), folder_chain AS (
      SELECT association."id" AS "associationId", folder."id" AS "ancestorId",
             folder."parentId", folder."workspaceId", folder."ownerUserId",
             folder."visibilityScope", folder."createdById"
        FROM authorized_association association
        JOIN "WorkspaceFolder" folder ON folder."id" = association."folderId"
      UNION ALL
      SELECT chain."associationId", parent."id", parent."parentId",
             parent."workspaceId", parent."ownerUserId",
             parent."visibilityScope", parent."createdById"
        FROM folder_chain chain
        JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
       WHERE parent."workspaceId" IS NOT DISTINCT FROM chain."workspaceId"
         AND parent."ownerUserId" IS NOT DISTINCT FROM chain."ownerUserId"
    )
    SELECT EXISTS (
      SELECT 1
        FROM authorized_association association
       WHERE NOT EXISTS (
         SELECT 1 FROM folder_chain chain
          WHERE chain."associationId" = association."id"
            AND CASE chain."visibilityScope"::text
              WHEN 'PERSONAL' THEN chain."ownerUserId" <> ${scope.userId}
              WHEN 'RESTRICTED' THEN NOT EXISTS (
                SELECT 1 FROM "WorkspaceMembership" membership
                 WHERE membership."workspaceId" = chain."workspaceId"
                   AND membership."userId" = ${scope.userId}
                   AND membership."active" = TRUE
                   AND (
                     membership."role" = 'ADMIN'
                     OR chain."createdById" = membership."userId"
                     OR EXISTS (
                       SELECT 1 FROM "WorkspaceFolderGrant" grant_row
                        WHERE grant_row."folderId" = chain."ancestorId"
                          AND grant_row."membershipId" = membership."id"
                     )
                   )
              )
              ELSE FALSE
            END
       )
    ) AS allowed
  `);
  return rows[0]?.allowed === true;
}

export function workspaceVisibilityLabel(scope: WorkspaceVisibilityScope) {
  switch (scope) {
    case 'PERSONAL':
      return 'Privado';
    case 'RESTRICTED':
      return 'Restringido';
    case 'DEPENDENCY_SHARED':
      return 'Compartido';
    default:
      return 'Hereda permisos';
  }
}
