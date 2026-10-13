-- Private TERM ACL plans depend on the changing PRIVATE_WORKSPACE population
-- and WorkspaceDocument cardinality. Lower the per-table auto-ANALYZE trigger
-- so PostgreSQL refreshes those estimates as private workspaces grow.
ALTER TABLE "CorpusDocument"
  SET (
    autovacuum_analyze_threshold = 50,
    autovacuum_analyze_scale_factor = 0.005
  );

ALTER TABLE "WorkspaceDocument"
  SET (
    autovacuum_analyze_threshold = 50,
    autovacuum_analyze_scale_factor = 0.02
  );

ANALYZE "CorpusDocument";
ANALYZE "WorkspaceDocument";
