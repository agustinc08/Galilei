CREATE TYPE "WorkspaceVisibilityScope" AS ENUM (
  'INHERIT',
  'PERSONAL',
  'DEPENDENCY_SHARED',
  'RESTRICTED'
);

ALTER TABLE "WorkspaceFolder"
  ALTER COLUMN "workspaceId" DROP NOT NULL,
  ADD COLUMN "ownerUserId" INTEGER,
  ADD COLUMN "visibilityScope" "WorkspaceVisibilityScope" NOT NULL DEFAULT 'DEPENDENCY_SHARED';

ALTER TABLE "WorkspaceDocument"
  ALTER COLUMN "workspaceId" DROP NOT NULL,
  ADD COLUMN "ownerUserId" INTEGER;

ALTER TABLE "WorkspaceFolder"
  ADD CONSTRAINT "WorkspaceFolder_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkspaceFolder_scope_owner_check"
    CHECK (("workspaceId" IS NULL) <> ("ownerUserId" IS NULL));

ALTER TABLE "WorkspaceDocument"
  ADD CONSTRAINT "WorkspaceDocument_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkspaceDocument_scope_owner_check"
    CHECK (("workspaceId" IS NULL) <> ("ownerUserId" IS NULL));

CREATE INDEX "WorkspaceFolder_ownerUserId_parentId_name_idx"
  ON "WorkspaceFolder"("ownerUserId", "parentId", "name");
CREATE INDEX "WorkspaceDocument_ownerUserId_createdAt_idx"
  ON "WorkspaceDocument"("ownerUserId", "createdAt");

CREATE TABLE "WorkspaceFolderGrant" (
  "id" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceFolderGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceFolderGrant_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "WorkspaceFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceFolderGrant_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspaceFolderGrant_folderId_membershipId_key"
  ON "WorkspaceFolderGrant"("folderId", "membershipId");
CREATE INDEX "WorkspaceFolderGrant_membershipId_folderId_idx"
  ON "WorkspaceFolderGrant"("membershipId", "folderId");
