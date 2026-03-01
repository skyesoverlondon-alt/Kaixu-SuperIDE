-- Migration from v1 schema to v2 schema
-- Run carefully once. If your DB is fresh, use schema_v2.sql instead.

alter table customers
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_status text,
  add column if not exists auto_topup_enabled boolean not null default false,
  add column if not exists auto_topup_amount_cents integer,
  add column if not exists auto_topup_threshold_cents integer;

alter table api_keys
  add column if not exists label text,
  add column if not exists monthly_cap_cents integer,
  add column if not exists rpm_limit integer,
  add column if not exists rpd_limit integer;

alter table monthly_usage
  add column if not exists extra_cents integer not null default 0;

-- Per-key monthly rollup (enables true sub-key caps + per-user dashboards)
create table if not exists monthly_key_usage (
  api_key_id bigint not null references api_keys(id) on delete cascade,
  customer_id bigint not null references customers(id) on delete cascade,
  month text not null,
  spent_cents integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (api_key_id, month)
);

create index if not exists monthly_key_usage_customer_month_idx on monthly_key_usage(customer_id, month);

create table if not exists audit_events (
  id bigserial primary key,
  actor text not null,
  action text not null,
  target text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_idx on audit_events(created_at desc);

create table if not exists rate_limit_windows (
  customer_id bigint not null references customers(id) on delete cascade,
  api_key_id bigint not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (customer_id, api_key_id, window_start)
);

create index if not exists rate_limit_windows_window_idx on rate_limit_windows(window_start desc);
