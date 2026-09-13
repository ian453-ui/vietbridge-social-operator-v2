# Version isolation

- `Publisher-P0` is the frozen legacy baseline. V2 never writes its source, database, port, profiles or process.
- `Social-Operator-V2` has an independent Git repository and semantic prototype releases.
- Prototype versions use `2.0.0-prototype.N`; no prototype enables live adapters.
- Reusable P0 behavior enters V2 through a versioned `publisher-core` adapter only after golden-trace compatibility tests pass.
- Database migrations are forward-only inside a new V2 local database. The P0 database is never migrated in place.
- Any future live release requires a tagged rollback point, exported schema manifest, P0 regression suite, V2 QA suite and explicit adapter enablement.
