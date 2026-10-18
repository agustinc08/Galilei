-- Search V2 indexes Sentencia as its own logical document. Child Sumario text
-- may enrich that document only through the existing Sentencia FK.
CREATE FUNCTION "search_index_sentence_document_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM "search_enqueue_key"(
            'JURISPRUDENCIA:SENTENCIA:' || (OLD."id")::TEXT,
            CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END
        );
    END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."id" IS DISTINCT FROM OLD."id") THEN
        PERFORM "search_enqueue_key"(
            'JURISPRUDENCIA:SENTENCIA:' || (NEW."id")::TEXT,
            'UPSERT'
        );
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "search_index_sumario_parent_sentence_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM "search_enqueue_key"(
            'JURISPRUDENCIA:SENTENCIA:' || (OLD."sentenciaId")::TEXT,
            'UPSERT'
        );
    END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."sentenciaId" IS DISTINCT FROM OLD."sentenciaId") THEN
        PERFORM "search_enqueue_key"(
            'JURISPRUDENCIA:SENTENCIA:' || (NEW."sentenciaId")::TEXT,
            'UPSERT'
        );
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "SearchIndexOutbox_SentenciaDocument_trg"
AFTER INSERT OR UPDATE OR DELETE ON "Sentencia"
FOR EACH ROW EXECUTE FUNCTION "search_index_sentence_document_trigger"();

CREATE TRIGGER "SearchIndexOutbox_SumarioParentSentence_trg"
AFTER INSERT OR UPDATE OR DELETE ON "Sumario"
FOR EACH ROW EXECUTE FUNCTION "search_index_sumario_parent_sentence_trigger"();
