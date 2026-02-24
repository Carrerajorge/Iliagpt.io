-- =============================================================================
-- Migration 0021: Admin User Projection (CQRS-Lite Materialized View)
-- =============================================================================

-- Materialized view for admin dashboard — replaces in-memory getAllUsers() filtering.
-- Refreshed concurrently on auth events (debounced 2s).

CREATE MATERIALIZED VIEW IF NOT EXISTS admin_user_projection AS
SELECT
  u.id,
  u.email,
  u.email_canonical,
  u.full_name,
  u.first_name,
  u.last_name,
  u.username,
  u.role,
  u.plan,
  u.status,
  u.auth_provider,
  u.email_verified,
  u.created_at,
  u.updated_at,
  u.last_login_at,
  u.login_count,
  u.query_count,
  u.tokens_consumed,
  u.credits_balance,
  u.stripe_customer_id,
  u.subscription_status,
  u.subscription_plan,
  u.org_id,
  u.last_ip,
  u.country_code,
  u.deleted_at,
  u.phone,
  u.company,
  -- Aggregated identity providers
  (SELECT array_agg(DISTINCT ui.provider)
   FROM user_identities ui
   WHERE ui.user_id = u.id) AS linked_providers,
  -- 2FA status
  EXISTS(
    SELECT 1 FROM user_2fa u2
    WHERE u2.user_id = u.id AND u2.is_enabled = true
  ) AS has_2fa,
  -- Active sessions count
  (SELECT COUNT(*)
   FROM sessions s
   WHERE s.user_id = u.id AND s.expire > NOW()) AS active_sessions
FROM users u
WHERE u.deleted_at IS NULL
WITH DATA;

-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS admin_user_projection_id_idx ON admin_user_projection(id);
CREATE INDEX IF NOT EXISTS admin_user_projection_email_idx ON admin_user_projection(email_canonical);
CREATE INDEX IF NOT EXISTS admin_user_projection_role_idx ON admin_user_projection(role);
CREATE INDEX IF NOT EXISTS admin_user_projection_status_idx ON admin_user_projection(status);
CREATE INDEX IF NOT EXISTS admin_user_projection_plan_idx ON admin_user_projection(plan);
CREATE INDEX IF NOT EXISTS admin_user_projection_created_idx ON admin_user_projection(created_at);
CREATE INDEX IF NOT EXISTS admin_user_projection_last_login_idx ON admin_user_projection(last_login_at);
