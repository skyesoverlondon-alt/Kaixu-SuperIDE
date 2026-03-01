-- kAIxU Gateway 13 — v5 → v6 Migration: Key Vault (encrypted_key storage)
-- This column stores an AES-256-GCM encrypted copy of the raw API key
-- so admins can retrieve/copy keys they own at any time.
-- Format: v1:<iv_b64url>:<tag_b64url>:<cipher_b64url>
-- Decryption uses DB_ENCRYPTION_KEY (or JWT_SECRET fallback).

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS encrypted_key text;

-- Backfill note: Keys created BEFORE this migration will have encrypted_key = NULL.
-- They cannot be retrieved. Rotating such a key will generate a new one WITH vault storage.
