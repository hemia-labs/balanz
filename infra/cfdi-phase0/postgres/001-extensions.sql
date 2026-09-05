-- Runs only when PostgreSQL initializes the isolated Phase 0 test volume.
-- Existing development databases are inspected, never modified by this file.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
