-- NOTE (v5+): The live schema is auto-provisioned/patch-migrated by netlify/functions/_lib/db.js on first request.
-- This SQL file is kept for reference only and may not include newer v5+ tables (push/monitor/async jobs/RBAC).

-- Kaixu Gateway Schema v2 (Postgres)
-- New: sub-keys (api_keys.label + overrides), audit log, Stripe fields, optional wallet add-ons.

create table if not exists customers (
  id bigserial primary key,
  email text not null unique,
  plan_name text not null default 'starter',
  monthly_cap_cents integer not null default 2000,
  is_active boolean not null default true,

  -- Stripe fields (optional)
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_status text,

  -- Auto top-up preferences (optional)
  auto_topup_enabled boolean not null default false,
  auto_topup_amount_cents integer,
  auto_topup_threshold_cents integer,

  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  key_hash text not null unique,
  key_last4 text not null,

  -- Sub-key metadata
  label text,
  monthly_cap_cents integer, -- null means "use customer monthly_cap_cents"
  rpm_limit integer,         -- null means "use DEFAULT_RPM_LIMIT or customer defaults"
  rpd_limit integer,         -- null means "use DEFAULT_RPD_LIMIT or customer defaults"

  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_customer_id_idx on api_keys(customer_id);

create table if not exists monthly_usage (
  customer_id bigint not null references customers(id) on delete cascade,
  month text not null, -- YYYY-MM (UTC)

  spent_cents integer not null default 0,  -- metered usage this month
  extra_cents integer not null default 0,  -- top-ups / add-on allowance for this month

  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (customer_id, month)
);

-- Per-key monthly rollup (enables true sub-key caps + per-user dashboards)
create table if not exists monthly_key_usage (
  api_key_id bigint not null references api_keys(id) on delete cascade,
  customer_id bigint not null references customers(id) on delete cascade,
  month text not null, -- YYYY-MM (UTC)

  spent_cents integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (api_key_id, month)
);

create index if not exists monthly_key_usage_customer_month_idx on monthly_key_usage(customer_id, month);

create table if not exists usage_events (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  api_key_id bigint not null references api_keys(id) on delete cascade,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_customer_month_idx on usage_events(customer_id, created_at desc);
create index if not exists usage_events_key_idx on usage_events(api_key_id, created_at desc);

create table if not exists audit_events (
  id bigserial primary key,
  actor text not null,      -- 'admin' or a future user id
  action text not null,     -- e.g. 'KEY_CREATE', 'KEY_REVOKE', 'BILLING_WEBHOOK'
  target text,              -- e.g. 'customer:12' or 'key:88'
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_idx on audit_events(created_at desc);

-- In-house RPM limiter (fixed 60s windows)
create table if not exists rate_limit_windows (
  customer_id bigint not null references customers(id) on delete cascade,
  api_key_id bigint not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (customer_id, api_key_id, window_start)
);

create index if not exists rate_limit_windows_window_idx on rate_limit_windows(window_start desc);
