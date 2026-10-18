CREATE FUNCTION "search_index_sentence_child_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_sentence_id INTEGER;
    new_sentence_id INTEGER;
    sentence_id INTEGER;
    target RECORD;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_sentence_id := (to_jsonb(OLD)->>'sentenciaId')::INTEGER; END IF;
    IF TG_OP <> 'DELETE' THEN new_sentence_id := (to_jsonb(NEW)->>'sentenciaId')::INTEGER; END IF;

    FOR sentence_id IN
        SELECT DISTINCT value
          FROM unnest(ARRAY[old_sentence_id, new_sentence_id]) AS ids(value)
         WHERE value IS NOT NULL
    LOOP
        PERFORM "search_enqueue_key"('JURISPRUDENCIA:SENTENCIA:' || sentence_id::TEXT, 'UPSERT');
        FOR target IN SELECT "id" FROM "Sumario" WHERE "sentenciaId" = sentence_id LOOP
            PERFORM "search_enqueue_key"('JURISPRUDENCIA:SUMARIO:' || target."id"::TEXT, 'UPSERT');
        END LOOP;
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "SearchIndexOutbox_ArchivoPdf_trg"
AFTER INSERT OR UPDATE OR DELETE ON "ArchivoPdf"
FOR EACH ROW EXECUTE FUNCTION "search_index_sentence_child_trigger"();

CREATE TRIGGER "SearchIndexOutbox_ReferenciaNormativa_trg"
AFTER INSERT OR UPDATE OR DELETE ON "ReferenciaNormativa"
FOR EACH ROW EXECUTE FUNCTION "search_index_sentence_child_trigger"();

CREATE TRIGGER "SearchIndexOutbox_ReferenciaJurisprudencial_trg"
AFTER INSERT OR UPDATE OR DELETE ON "ReferenciaJurisprudencial"
FOR EACH ROW EXECUTE FUNCTION "search_index_sentence_child_trigger"();

CREATE TRIGGER "SearchIndexOutbox_ReferenciaDoctrinaria_trg"
AFTER INSERT OR UPDATE OR DELETE ON "ReferenciaDoctrinaria"
FOR EACH ROW EXECUTE FUNCTION "search_index_sentence_child_trigger"();
