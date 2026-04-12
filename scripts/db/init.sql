-- =============================================================================
-- IliaGPT — PostgreSQL Init Script
-- Run once when container is first created
-- =============================================================================

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable unaccent for accent-insensitive search
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Set default search path
ALTER DATABASE iliagpt SET search_path TO public;

-- Set performance-friendly defaults for the application user
ALTER ROLE iliagpt SET statement_timeout = '30s';
ALTER ROLE iliagpt SET lock_timeout = '10s';
ALTER ROLE iliagpt SET idle_in_transaction_session_timeout = '60s';
