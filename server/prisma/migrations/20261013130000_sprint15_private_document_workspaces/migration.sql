CREATE TYPE "CorpusDocumentScope" AS ENUM ('GENERAL', 'PRIVATE_WORKSPACE');
CREATE TYPE "WorkspaceDependencyType" AS ENUM ('JUZGADO', 'SALA', 'SECRETARIA', 'DEPENDENCIA');
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

ALTER TABLE "CorpusDocument"
  ADD COLUMN "documentScope" "CorpusDocumentScope" NOT NULL DEFAULT 'GENERAL';
CREATE INDEX "CorpusDocument_documentScope_visibility_status_idx"
  ON "CorpusDocument"("documentScope", "visibility", "status");

CREATE TABLE "DocumentDependency" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "WorkspaceDependencyType" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentDependency_code_key" ON "DocumentDependency"("code");
CREATE INDEX "DocumentDependency_active_type_name_idx" ON "DocumentDependency"("active", "type", "name");

CREATE TABLE "DocumentWorkspace" (
  "id" TEXT NOT NULL,
  "dependencyId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentWorkspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentWorkspace_dependencyId_key" ON "DocumentWorkspace"("dependencyId");
CREATE INDEX "DocumentWorkspace_active_idx" ON "DocumentWorkspace"("active");
ALTER TABLE "DocumentWorkspace" ADD CONSTRAINT "DocumentWorkspace_dependencyId_fkey"
  FOREIGN KEY ("dependencyId") REFERENCES "DocumentDependency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkspaceMembership" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "role" "WorkspaceRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");
CREATE INDEX "WorkspaceMembership_userId_active_idx" ON "WorkspaceMembership"("userId", "active");
CREATE INDEX "WorkspaceMembership_workspaceId_active_role_idx" ON "WorkspaceMembership"("workspaceId", "active", "role");
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkspaceFolder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkspaceFolder_workspaceId_parentId_name_idx" ON "WorkspaceFolder"("workspaceId", "parentId", "name");
ALTER TABLE "WorkspaceFolder" ADD CONSTRAINT "WorkspaceFolder_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceFolder" ADD CONSTRAINT "WorkspaceFolder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "WorkspaceFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceFolder" ADD CONSTRAINT "WorkspaceFolder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkspaceDocument" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "folderId" TEXT,
  "uploadedById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceDocument_workspaceId_documentId_key" ON "WorkspaceDocument"("workspaceId", "documentId");
CREATE INDEX "WorkspaceDocument_workspaceId_createdAt_idx" ON "WorkspaceDocument"("workspaceId", "createdAt");
CREATE INDEX "WorkspaceDocument_workspaceId_folderId_createdAt_idx" ON "WorkspaceDocument"("workspaceId", "folderId", "createdAt");
CREATE INDEX "WorkspaceDocument_documentId_idx" ON "WorkspaceDocument"("documentId");
ALTER TABLE "WorkspaceDocument" ADD CONSTRAINT "WorkspaceDocument_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDocument" ADD CONSTRAINT "WorkspaceDocument_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDocument" ADD CONSTRAINT "WorkspaceDocument_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "WorkspaceFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDocument" ADD CONSTRAINT "WorkspaceDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
