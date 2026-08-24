# Deferred physical cleanup

The Slim cutover stops all old writers and removes their active code, but migration `0034` does not drop historical tables. This preserves rollback and existing document binaries.

Only after every current document is mapped, parsed, retrieval-tested, backed up, and the rollback window is closed should a separate reviewed migration:

1. record row counts and schema-only/data backups;
2. drop old Requirement, Scope, Action, Risk, Weekly Report, Timesheet, Product Map, AI Thread/Execution, ingestion, Section/Chunk, embedding and retrieval tables;
3. drop obsolete triggers, enums, pgvector/trigram indexes and extensions only after confirming no other application uses them;
4. remove legacy `project_document_versions`, knowledge-space columns/tables, existing business MinIO credentials and volumes only after object retention sign-off;
5. rehearse restore into an isolated database before any Staging or Production apply.

No cleanup migration is authorized by the Slim implementation itself.
