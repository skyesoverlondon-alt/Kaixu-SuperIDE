-- NOTE (v5+): The live schema is auto-provisioned/patch-migrated by netlify/functions/_lib/db.js on first request.
-- Keep this migration as reference only.

-- Kaixu Gateway: migrate schema_v2 -> v5
-- Safe to run multiple times.

-- Customers additions
alter table customers
  add column if not exists max_devices_per_key integer,
  add column if not exists require_install_id boolean not null default false,
  add column if not exists allowed_providers text[],
  add column if not exists allowed_models jsonb,
  add column if not exists stripe_current_period_end timestamptz;

-- API keys additions
alter table api_keys
  add column if not exists max_devices integer,
  add column if not exists require_install_id boolean,
  add column if not exists allowed_providers text[],
  add column if not exists allowed_models jsonb;

-- Usage events additions
alter table usage_events
  add column if not exists install_id text;

create index if not exists usage_events_install_idx on usage_events(install_id, created_at desc);

-- Per-device seats
create table if not exists key_devices (
  customer_id bigint not null references customers(id) on delete cascade,
  api_key_id bigint not null references api_keys(id) on delete cascade,
  install_id text not null,
  device_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_seen_ua text,
  revoked_at timestamptz,
  revoked_by text,
  primary key (api_key_id, install_id)
);

create index if not exists key_devices_customer_idx on key_devices(customer_id);
create index if not exists key_devices_last_seen_idx on key_devices(api_key_id, last_seen_at desc);

-- Top-up tracking
create table if not exists topup_events (
  id bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  month text not null,
  amount_cents integer not null,
  source text not null, -- 'stripe'|'manual'
  stripe_session_id text,
  status text not null default 'applied',
  created_at timestamptz not null default now()
);

create index if not exists topup_events_customer_month_idx on topup_events(customer_id, month);

-- Monthly invoice snapshots
create table if not exists monthly_invoices (
  customer_id bigint not null references customers(id) on delete cascade,
  month text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, month)
);

create index if not exists monthly_invoices_customer_month_idx on monthly_invoices(customer_id, month);
