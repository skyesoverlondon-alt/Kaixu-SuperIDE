-- kAIxU Super IDE — Neon schema

-- Enable gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default 'Default Workspace',
  -- files stored as { "path": "content", ... }
  files jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspaces_user_id on workspaces(user_id);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  text text not null,
  operations jsonb,
  checkpoint_commit_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_chats_workspace_id on chats(workspace_id);


-- Orgs + membership (Fortune-500 multi-tenant)

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists org_memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','member','viewer')),
  token text unique not null,
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Extend workspaces for org scoping
alter table workspaces add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table workspaces add column if not exists created_by uuid references users(id) on delete set null;

-- ─── Workspace Templates (Phase 12.5) ─────────────────────────────────────
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  name text not null,
  description text not null default '',
  tags text[] not null default '{}',
  emoji text not null default '📄',
  files jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_templates_org_id on templates(org_id);
create index if not exists idx_templates_is_public on templates(is_public);

-- ─── GitHub Integration (per workspace) ───────────────────────────────────
-- github_pat    : Fine-grained PAT scoped to target repo (contents:write)
-- github_tree_map : { "path": "gitBlobSha", ... } for fast diff on push
create table if not exists workspace_github (
  workspace_id  uuid primary key references workspaces(id) on delete cascade,
  github_pat    text not null,
  github_owner  text not null,
  github_repo   text not null,
  github_branch text not null default 'main',
  github_last_sha text,
  github_tree_map jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- ─── Password Reset Tokens ────────────────────────────────────────────────
create table if not exists password_reset_tokens (
  user_id    uuid primary key references users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ─── Rate Limit Log ───────────────────────────────────────────────────────
create table if not exists rate_limit_log (
  id         bigserial primary key,
  bucket_key text not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rll_key_action_ts on rate_limit_log(bucket_key, action, created_at);

-- ─── Sessions (revokable JWT tracking) ───────────────────────────────────
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,       -- sha256 of the JWT
  device_hint text not null default '',   -- browser UA snippet
  ip          text not null default '',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists idx_sessions_user_id on sessions(user_id);

-- ─── Email Verification ───────────────────────────────────────────────────
alter table users add column if not exists email_verified boolean not null default false;
create table if not exists email_verifications (
  user_id    uuid primary key references users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ─── AI Usage Log (metering + dashboard) ─────────────────────────────────
create table if not exists ai_usage_log (
  id           bigserial primary key,
  user_id      uuid references users(id) on delete set null,
  org_id       uuid references orgs(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete set null,
  model        text not null default 'default',
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  latency_ms   int not null default 0,
  success      boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ai_usage_user_id   on ai_usage_log(user_id, created_at);
create index if not exists idx_ai_usage_org_id    on ai_usage_log(org_id, created_at);

-- ─── Global Settings (kill switches, feature flags) ──────────────────────
create table if not exists global_settings (
  key   text primary key,
  value text not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into global_settings(key, value) values ('ai_enabled', 'true') on conflict do nothing;

-- ─── Org Invites (extended with accepted_at, accepted_by) ─────────────────
alter table org_invites add column if not exists accepted_at timestamptz;
alter table org_invites add column if not exists accepted_by uuid references users(id) on delete set null;

-- ─── Workspace Roles (per-workspace granular permissions) ─────────────────
create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null check (role in ('owner','editor','viewer')),
  created_at   timestamptz not null default now(),
  primary key  (workspace_id, user_id)
);

-- ─── Workspace Shares (signed read-only preview links) ────────────────────
create table if not exists workspace_shares (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token        text not null unique,
  created_by   uuid references users(id) on delete set null,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── Webhooks (workspace events → external URL) ───────────────────────────
create table if not exists webhooks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references orgs(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  url          text not null,
  events       text[] not null default '{}',  -- e.g. {'ws.save','chat.append'}
  secret       text not null,
  enabled      boolean not null default true,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ─── Agent Memory (per workspace preferences) ────────────────────────────
create table if not exists agent_memory (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  memory       text not null default '',   -- free-text style guide / conventions
  updated_at   timestamptz not null default now()
);

-- ─── MFA / TOTP ───────────────────────────────────────────────────────────
alter table users add column if not exists mfa_secret  text;
alter table users add column if not exists mfa_enabled boolean not null default false;

-- ─── Soft Deletes + Transfer ──────────────────────────────────────────────
alter table workspaces add column if not exists deleted_at    timestamptz;
alter table workspaces add column if not exists owner_user_id uuid references users(id) on delete set null;
alter table orgs       add column if not exists deleted_at    timestamptz;

-- ─── File / Line Comments ─────────────────────────────────────────────────
create table if not exists file_comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  file_path    text not null,
  line_number  int,
  content      text not null,
  user_id      uuid references users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_file_comments_ws on file_comments(workspace_id, file_path);

-- ─── Tasks / Issues ───────────────────────────────────────────────────────
create table if not exists tasks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references orgs(id)  on delete cascade,
  workspace_id     uuid references workspaces(id) on delete cascade,
  title            text not null,
  description      text,
  status           text not null default 'open'   check (status in ('open','in_progress','done')),
  priority         text not null default 'medium' check (priority in ('low','medium','high')),
  assignee_user_id uuid references users(id) on delete set null,
  created_by       uuid references users(id) on delete set null,
  due_date         date,
  created_at       timestamptz not null default now()
);
create index if not exists idx_tasks_org_id       on tasks(org_id);
create index if not exists idx_tasks_workspace_id on tasks(workspace_id);
create index if not exists idx_tasks_created_by   on tasks(created_by);

-- ─── Review Requests ──────────────────────────────────────────────────────
create table if not exists reviews (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  title        text not null,
  description  text,
  commit_ids   text[] not null default '{}',
  status       text not null default 'pending' check (status in ('pending','approved','changes_requested','closed')),
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_reviews_workspace_id on reviews(workspace_id);

create table if not exists review_comments (
  id        uuid primary key default gen_random_uuid(),
  review_id uuid references reviews(id) on delete cascade,
  user_id   uuid references users(id)   on delete set null,
  content   text not null,
  decision  text check (decision in ('approve','request_changes')),
  created_at timestamptz not null default now()
);

-- ─── Teams ────────────────────────────────────────────────────────────────
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_teams_org_id on teams(org_id);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table if not exists team_workspace_access (
  team_id      uuid not null references teams(id)      on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role         text not null default 'viewer' check (role in ('owner','editor','viewer')),
  primary key (team_id, workspace_id)
);


-- ─── Billing: Plans ───────────────────────────────────────────────────────
create table if not exists plans (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  description      text,
  price_cents      integer not null default 0,    -- per month in cents
  stripe_price_id  text,                          -- Stripe Price ID (e.g. price_xxx)
  ai_calls_limit   integer not null default 100,  -- AI calls per month
  seats_limit      integer not null default 1,    -- max seats per org
  features         jsonb not null default '[]',   -- feature flag list
  is_public        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Seed default plans (idempotent)
insert into plans (name, slug, description, price_cents, ai_calls_limit, seats_limit, features)
values
  ('Free',       'free',    'Ideal for solo projects',         0,     100,  1,  '["5 workspaces","Community support"]'::jsonb),
  ('Pro',        'pro',     'Built for individual developers', 900,   2000, 1,  '["Unlimited workspaces","AI watch mode","Priority support"]'::jsonb),
  ('Team',       'team',    'Collaborate with your team',      2500,  10000, 20, '["Everything in Pro","Team groups","Code reviews","Org dashboard"]'::jsonb),
  ('Enterprise', 'enterprise','Unlimited scale & compliance',  9900,  -1, -1,  '["Everything in Team","SSO","SOC2 export","Custom roles","SLA"]'::jsonb)
on conflict (slug) do nothing;

-- ─── Billing: Subscriptions ───────────────────────────────────────────────
create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  stripe_subscription_id  text not null unique,
  stripe_customer_id      text,
  user_id                 uuid references users(id) on delete set null,
  org_id                  uuid references orgs(id)  on delete set null,
  plan_id                 uuid references plans(id) on delete set null,
  status                  text not null default 'active'
                            check (status in ('active','trialing','past_due','canceled','unpaid')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  canceled_at             timestamptz,
  last_invoice_at         timestamptz,
  last_invoice_amount     integer,   -- in cents
  created_at              timestamptz not null default now()
);
create index if not exists idx_subscriptions_user on subscriptions(user_id);
create index if not exists idx_subscriptions_org  on subscriptions(org_id);

-- ─── Billing: Usage Metering ──────────────────────────────────────────────
create table if not exists usage_meters (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete set null,
  user_id         uuid references users(id)          on delete set null,
  org_id          uuid references orgs(id)           on delete set null,
  event           text not null,              -- 'ai_call','ws_save','invoice_paid', etc.
  amount_cents    integer,                    -- for invoice events
  quantity        integer not null default 1,
  recorded_at     timestamptz not null default now()
);
create index if not exists idx_usage_meters_sub  on usage_meters(subscription_id);
create index if not exists idx_usage_meters_user on usage_meters(user_id);
create index if not exists idx_usage_meters_org  on usage_meters(org_id);

-- ─── Add billing columns to users and orgs ────────────────────────────────
alter table users add column if not exists stripe_customer_id text;
alter table users add column if not exists plan_id uuid references plans(id) on delete set null;
alter table orgs  add column if not exists plan_id uuid references plans(id) on delete set null;

-- ─── RAG: Embeddings (requires pgvector extension) ────────────────────────
-- Run: CREATE EXTENSION IF NOT EXISTS vector;
-- in Neon SQL console before deploying.

create table if not exists file_embeddings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  file_path    text not null,
  chunk_index  integer not null default 0,
  chunk_text   text not null,
  embedding    vector(768),     -- Gemini text-embedding-004 dimension
  updated_at   timestamptz not null default now(),
  unique (workspace_id, file_path, chunk_index)
);
create index if not exists idx_file_embeddings_ws on file_embeddings(workspace_id);
-- Approx NN index (created separately after extension confirmed):
-- create index if not exists idx_file_embeddings_hnsw on file_embeddings
--   using hnsw (embedding vector_cosine_ops) with (m=16, ef_construction=64);

-- ─── Notification Preferences ─────────────────────────────────────────────
create table if not exists notification_preferences (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references users(id) on delete cascade,
  org_id           uuid references orgs(id)  on delete cascade,
  channel          text not null check (channel in ('email','slack','webhook')),
  config           jsonb not null default '{}',
  -- For email: { "to": "user@example.com" }
  -- For slack:  { "webhook_url": "https://hooks.slack.com/..." }
  -- For webhook: { "url": "https://...", "secret": "..." }
  events           text[] not null default '{"task.created","review.requested","ws.shared","invite.accepted"}',
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (user_id, channel),
  unique (org_id, channel)
);
create index if not exists idx_notif_user on notification_preferences(user_id);
create index if not exists idx_notif_org  on notification_preferences(org_id);

-- ─── SSO-ready columns on orgs ─────────────────────────────────────────────
-- SSO-ready structure (structure only; actual IdP integration is future work)
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_enabled      boolean     NOT NULL DEFAULT false;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_provider     text;        -- 'saml' | 'oidc' | 'google' | 'okta'
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_domain       text;        -- e.g. 'acme.com' — users with this domain auto-join org
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_metadata_url text;        -- IdP metadata / discovery URL
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_client_id    text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sso_config       jsonb NOT NULL DEFAULT '{}';

create unique index if not exists idx_orgs_sso_domain on orgs(sso_domain) where sso_domain is not null;

-- ─── MFA enforcement on orgs ────────────────────────────────────────────────
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;

-- ─── KaixuSI Customer API Keys ───────────────────────────────────────────────
-- Per-user API keys dispensed to customers. Stored as SHA-256 hashes.
-- Plaintext is shown once on creation and never stored.
-- Keys are prefixed `ksk_` so they're easy to identify.
create table if not exists kaixu_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  key_hash     text not null unique,            -- SHA-256 of plaintext key
  label        text not null default 'My KaixuSI Key',
  status       text not null default 'active'  check (status in ('active','revoked')),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_kaixu_keys_user_id  on kaixu_keys(user_id);
create index if not exists idx_kaixu_keys_key_hash on kaixu_keys(key_hash);
create index if not exists idx_kaixu_keys_status   on kaixu_keys(status);
-- ─── KaixuSI Customer API Keys (enterprise / dispensed) ─────────────────────
-- Full-featured key table: quota tracking, owner attribution, revocation.
-- Only the SHA-256 hash of the plaintext `kxsi_...` key is ever stored.
create table if not exists kaixu_customer_keys (
  id            uuid        primary key default gen_random_uuid(),
  key_hash      text        not null unique,           -- SHA-256 of kxsi_… key
  label         text,                                  -- friendly name
  owner_email   text,                                  -- customer contact
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,                           -- null = active
  last_used_at  timestamptz,
  call_count    int         not null default 0,
  monthly_limit int         not null default 1000,
  is_active     boolean     not null default true
);

create index if not exists idx_kxc_keys_hash     on kaixu_customer_keys(key_hash);
create index if not exists idx_kxc_keys_active   on kaixu_customer_keys(is_active);
create index if not exists idx_kxc_keys_email    on kaixu_customer_keys(owner_email);

-- ─── AI Background Jobs ───────────────────────────────────────────────────────
-- Stores async AI job state for background-function polling pattern.
-- Client generates jobId (UUID), POSTs to ai-edit-run-background, polls ai-job-status.
create table if not exists ai_jobs (
  id            uuid        primary key,                    -- client-generated UUID
  user_id       uuid        references users(id) on delete cascade,
  workspace_id  uuid        references workspaces(id) on delete cascade,
  org_id        uuid        references orgs(id) on delete cascade,
  status        text        not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'error')),
  result        jsonb,                                      -- final AI response
  error         text,                                      -- error message if failed
  model         text,                                      -- resolved model used
  prompt_tokens int         not null default 0,
  completion_tokens int     not null default 0,
  latency_ms    int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_ai_jobs_user_id      on ai_jobs(user_id);
create index if not exists idx_ai_jobs_workspace_id on ai_jobs(workspace_id);
create index if not exists idx_ai_jobs_status       on ai_jobs(status);
-- Auto-expire jobs older than 24h (run via pg_cron or manual cron)
-- DELETE FROM ai_jobs WHERE created_at < now() - interval '24 hours';
create index if not exists idx_kxc_keys_email    on kaixu_customer_keys(owner_email);