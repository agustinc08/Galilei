CREATE TABLE "SearchIndexOutbox" (
    "id" BIGSERIAL NOT NULL,
    "documentKey" TEXT NOT NULL,
    "operation" VARCHAR(8) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ,
    "lastError" VARCHAR(120),
    "processedAt" TIMESTAMPTZ,
    "failedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchIndexOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SearchIndexOutbox_operation_check" CHECK ("operation" IN ('UPSERT', 'DELETE')),
    CONSTRAINT "SearchIndexOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "SearchIndexOutbox_pending_idx"
    ON "SearchIndexOutbox" ("processedAt", "nextAttemptAt", "id");

CREATE FUNCTION "search_enqueue_key"(document_key TEXT, operation_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF document_key IS NULL OR btrim(document_key) = '' THEN
        RETURN;
    END IF;
    INSERT INTO "SearchIndexOutbox" ("documentKey", "operation")
    VALUES (document_key, operation_name);
END;
$$;

CREATE FUNCTION "search_enqueue_workspace_docs"(workspace_key TEXT, owner_key INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE target RECORD;
BEGIN
    IF workspace_key IS NULL AND owner_key IS NULL THEN
        RETURN;
    END IF;
    FOR target IN
        SELECT DISTINCT "documentId"
          FROM "WorkspaceDocument"
         WHERE (workspace_key IS NOT NULL AND "workspaceId" = workspace_key AND "ownerUserId" IS NULL)
            OR (owner_key IS NOT NULL AND "workspaceId" IS NULL AND "ownerUserId" = owner_key)
    LOOP
        PERFORM "search_enqueue_key"('CORPUS:' || target."documentId", 'UPSERT');
    END LOOP;
END;
$$;

CREATE FUNCTION "search_index_outbox_row_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_data JSONB;
    new_data JSONB;
    old_id TEXT;
    new_id TEXT;
    document_id TEXT;
    source_id TEXT;
    workspace_key TEXT;
    owner_key INTEGER;
    folder_key TEXT;
    target RECORD;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;

    IF TG_TABLE_NAME = 'CorpusDocument' THEN
        document_id := COALESCE(new_data->>'id', old_data->>'id');
        PERFORM "search_enqueue_key"('CORPUS:' || document_id, CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END);
    ELSIF TG_TABLE_NAME IN (
        'CorpusDocumentFile', 'CorpusExtraction', 'CorpusDocumentLink', 'CorpusDocumentTopic',
        'CorpusDocumentTag', 'DigestoCollectionMembership', 'WorkspaceDocument', 'SourceFile'
    ) THEN
        old_id := old_data->>'documentId';
        new_id := new_data->>'documentId';
        IF old_id IS NOT NULL THEN PERFORM "search_enqueue_key"('CORPUS:' || old_id, 'UPSERT'); END IF;
        IF new_id IS NOT NULL AND new_id IS DISTINCT FROM old_id THEN
            PERFORM "search_enqueue_key"('CORPUS:' || new_id, 'UPSERT');
        END IF;
    ELSIF TG_TABLE_NAME = 'CorpusDocumentPage' THEN
        FOR document_id IN
            SELECT DISTINCT extraction."documentId"
              FROM "CorpusExtraction" extraction
             WHERE extraction."id" IN (old_data->>'extractionId', new_data->>'extractionId')
        LOOP
            PERFORM "search_enqueue_key"('CORPUS:' || document_id, 'UPSERT');
        END LOOP;
    ELSIF TG_TABLE_NAME = 'Sentencia' THEN
        FOR target IN
            SELECT sumario."id" FROM "Sumario" sumario
             WHERE sumario."sentenciaId" = ANY(ARRAY[(old_data->>'id')::INTEGER, (new_data->>'id')::INTEGER])
        LOOP
            PERFORM "search_enqueue_key"('JURISPRUDENCIA:SUMARIO:' || target."id", 'UPSERT');
        END LOOP;
    ELSIF TG_TABLE_NAME = 'Sumario' THEN
        IF old_data->>'id' IS NOT NULL THEN
            PERFORM "search_enqueue_key"('JURISPRUDENCIA:SUMARIO:' || (old_data->>'id'), CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END);
        END IF;
        IF new_data->>'id' IS NOT NULL AND new_data->>'id' IS DISTINCT FROM old_data->>'id' THEN
            PERFORM "search_enqueue_key"('JURISPRUDENCIA:SUMARIO:' || (new_data->>'id'), 'UPSERT');
        END IF;
        IF old_data->>'sentenciaId' IS DISTINCT FROM new_data->>'sentenciaId' THEN
            FOR target IN
                SELECT sumario."id" FROM "Sumario" sumario
                 WHERE sumario."sentenciaId" = (new_data->>'sentenciaId')::INTEGER
            LOOP
                PERFORM "search_enqueue_key"('JURISPRUDENCIA:SUMARIO:' || target."id", 'UPSERT');
            END LOOP;
        END IF;
    ELSIF TG_TABLE_NAME IN ('WorkspaceMembership', 'DocumentWorkspace') THEN
        FOR workspace_key IN
            SELECT DISTINCT value
              FROM unnest(CASE WHEN TG_TABLE_NAME = 'DocumentWorkspace'
                    THEN ARRAY[old_data->>'id', new_data->>'id']
                    ELSE ARRAY[old_data->>'workspaceId', new_data->>'workspaceId']
                  END) AS keys(value)
             WHERE value IS NOT NULL
        LOOP
            PERFORM "search_enqueue_workspace_docs"(workspace_key, NULL);
        END LOOP;
    ELSIF TG_TABLE_NAME = 'WorkspaceFolder' THEN
        FOR target IN
            SELECT DISTINCT entry.workspace_key, entry.owner_value
              FROM (VALUES (old_data->>'workspaceId', old_data->>'ownerUserId'),
                           (new_data->>'workspaceId', new_data->>'ownerUserId')) AS entry(workspace_key, owner_value)
             WHERE entry.workspace_key IS NOT NULL OR entry.owner_value IS NOT NULL
        LOOP
            owner_key := NULLIF(target.owner_value, '')::INTEGER;
            PERFORM "search_enqueue_workspace_docs"(target.workspace_key, owner_key);
        END LOOP;
    ELSIF TG_TABLE_NAME = 'WorkspaceFolderGrant' THEN
        FOR target IN
            SELECT DISTINCT folder."workspaceId", folder."ownerUserId"
              FROM "WorkspaceFolder" folder
             WHERE folder."id" IN (old_data->>'folderId', new_data->>'folderId')
        LOOP
            PERFORM "search_enqueue_workspace_docs"(target."workspaceId", target."ownerUserId");
        END LOOP;
    ELSIF TG_TABLE_NAME = 'DocumentSource' THEN
        FOR source_id IN SELECT DISTINCT unnest(ARRAY[old_data->>'id', new_data->>'id']) LOOP
            FOR document_id IN SELECT DISTINCT file."documentId" FROM "SourceFile" file WHERE file."sourceId" = source_id LOOP
                PERFORM "search_enqueue_key"('CORPUS:' || document_id, 'UPSERT');
            END LOOP;
        END LOOP;
    ELSIF TG_TABLE_NAME = 'DigestoCollection' THEN
        FOR document_id IN
            SELECT DISTINCT membership."documentId" FROM "DigestoCollectionMembership" membership
             WHERE membership."collectionId" IN (old_data->>'id', new_data->>'id')
        LOOP
            PERFORM "search_enqueue_key"('CORPUS:' || document_id, 'UPSERT');
        END LOOP;
    ELSIF TG_TABLE_NAME = 'DigestoTopic' THEN
        FOR document_id IN
            SELECT DISTINCT link."documentId" FROM "CorpusDocumentTopic" link
             WHERE link."topicId" IN (old_data->>'id', new_data->>'id')
        LOOP
            PERFORM "search_enqueue_key"('CORPUS:' || document_id, 'UPSERT');
        END LOOP;
    ELSIF TG_TABLE_NAME = 'DigestoTag' THEN
        FOR document_id IN
            SELECT DISTINCT link."documentId" FROM "CorpusDocumentTag" link
             WHERE link."tagId" IN (old_data->>'id', new_data->>'id')
        LOOP
            PERFORM "search_enqueue_key"('CORPUS:' || document_id, 'UPSERT');
        END LOOP;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "SearchIndexOutbox_CorpusDocument_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocument"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusDocumentFile_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocumentFile"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusExtraction_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusExtraction"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusDocumentPage_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocumentPage"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusDocumentLink_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocumentLink"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusDocumentTopic_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocumentTopic"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_CorpusDocumentTag_trg"
AFTER INSERT OR UPDATE OR DELETE ON "CorpusDocumentTag"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DigestoCollectionMembership_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DigestoCollectionMembership"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_WorkspaceDocument_trg"
AFTER INSERT OR UPDATE OR DELETE ON "WorkspaceDocument"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_SourceFile_trg"
AFTER INSERT OR UPDATE OR DELETE ON "SourceFile"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_Sentencia_trg"
AFTER INSERT OR UPDATE OR DELETE ON "Sentencia"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_Sumario_trg"
AFTER INSERT OR UPDATE OR DELETE ON "Sumario"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_WorkspaceMembership_trg"
AFTER INSERT OR UPDATE OR DELETE ON "WorkspaceMembership"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DocumentWorkspace_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DocumentWorkspace"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_WorkspaceFolder_trg"
AFTER INSERT OR UPDATE OR DELETE ON "WorkspaceFolder"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_WorkspaceFolderGrant_trg"
AFTER INSERT OR UPDATE OR DELETE ON "WorkspaceFolderGrant"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DocumentSource_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DocumentSource"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DigestoCollection_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DigestoCollection"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DigestoTopic_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DigestoTopic"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
CREATE TRIGGER "SearchIndexOutbox_DigestoTag_trg"
AFTER INSERT OR UPDATE OR DELETE ON "DigestoTag"
FOR EACH ROW EXECUTE FUNCTION "search_index_outbox_row_trigger"();
