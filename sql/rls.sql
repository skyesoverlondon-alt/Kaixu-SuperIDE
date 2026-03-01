-- rls.sql — Row Level Security policies for Kaixu SuperIDE
--
-- IMPORTANT: Run this AFTER schema.sql.
-- In Neon console or migration runner:
--   SET app.current_user_id = '<uuid>' before queries, OR
--   use a dedicated RLS role (see _lib/rls-db.js).
--
-- These policies assume queries always call:
--   SET LOCAL app.current_user_id = '<user_uuid>';
-- before accessing protected tables.

-- ─── Helpers ──────────────────────────────────────────────────────────────
-- Safe accessor — returns null if setting not set (avoids error)
-- Usage: current_user_id() → uuid or null

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ─── Users ────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- Each user can only read/update their own row; admins skip RLS via BYPASSRLS
CREATE POLICY users_own_select ON users
  FOR SELECT USING (id = app_current_user_id());
CREATE POLICY users_own_update ON users
  FOR UPDATE USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- ─── Workspaces ───────────────────────────────────────────────────────────
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_owner_all ON workspaces
  USING (user_id = app_current_user_id() OR owner_user_id = app_current_user_id());
CREATE POLICY ws_member_select ON workspaces
  FOR SELECT
  USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = app_current_user_id()
    )
  );

-- ─── Workspace Members ────────────────────────────────────────────────────
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY wm_select ON workspace_members
  FOR SELECT
  USING (
    user_id = app_current_user_id()
    OR workspace_id IN (
      SELECT id FROM workspaces
      WHERE user_id = app_current_user_id() OR owner_user_id = app_current_user_id()
    )
  );

-- ─── Orgs ─────────────────────────────────────────────────────────────────
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
CREATE POLICY orgs_member_select ON orgs
  FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM org_members WHERE user_id = app_current_user_id()
    )
  );
CREATE POLICY orgs_owner_all ON orgs
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE user_id = app_current_user_id() AND role IN ('owner','admin')
    )
  );

-- ─── Org Members ──────────────────────────────────────────────────────────
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY om_select ON org_members
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = app_current_user_id()
    )
  );

-- ─── Chat Messages ────────────────────────────────────────────────────────
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_ws_access ON chat_messages
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = app_current_user_id()
      UNION
      SELECT id FROM workspaces WHERE user_id = app_current_user_id()
    )
  );

-- ─── File Comments ────────────────────────────────────────────────────────
ALTER TABLE file_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY fcomment_ws_access ON file_comments
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = app_current_user_id()
      UNION
      SELECT id FROM workspaces WHERE user_id = app_current_user_id()
    )
  );
CREATE POLICY fcomment_own_write ON file_comments
  FOR ALL
  USING (author_user_id = app_current_user_id())
  WITH CHECK (author_user_id = app_current_user_id());

-- ─── Tasks ────────────────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_org_or_ws ON tasks
  FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = app_current_user_id())
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = app_current_user_id()
      UNION SELECT id FROM workspaces WHERE user_id = app_current_user_id()
    )
  );
CREATE POLICY tasks_own_write ON tasks
  FOR ALL
  USING (created_by = app_current_user_id())
  WITH CHECK (created_by = app_current_user_id());

-- ─── Reviews ──────────────────────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_ws_access ON reviews
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = app_current_user_id()
      UNION SELECT id FROM workspaces WHERE user_id = app_current_user_id()
    )
  );
CREATE POLICY reviews_own_write ON reviews
  FOR ALL
  USING (created_by = app_current_user_id())
  WITH CHECK (created_by = app_current_user_id());

-- ─── Teams ────────────────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_org_member ON teams
  FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = app_current_user_id())
  );

-- ─── Subscriptions ────────────────────────────────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sub_own ON subscriptions
  FOR SELECT
  USING (
    user_id = app_current_user_id()
    OR org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = app_current_user_id() AND role IN ('owner','admin')
    )
  );

-- ─── File Embeddings ──────────────────────────────────────────────────────
ALTER TABLE file_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY embed_ws_access ON file_embeddings
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = app_current_user_id()
      UNION SELECT id FROM workspaces WHERE user_id = app_current_user_id()
    )
  );

-- ─── Audit Logs ───────────────────────────────────────────────────────────
-- Audit logs: admins only via BYPASSRLS; regular users read their own actions
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_own ON audit_logs
  FOR SELECT
  USING (user_id = app_current_user_id());
