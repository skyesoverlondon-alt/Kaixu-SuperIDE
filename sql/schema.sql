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
