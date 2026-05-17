/**
 * Database row types — match 001_auth.sql + 002_connectors.sql.
 *
 * Used during the /web/ port to type queries. Existing tables
 * (daily_checkin, personal_goals, training_plans, etc.) have their
 * own types elsewhere; this file only covers the new multi-tenant
 * tables: users, sessions, password_resets, connector_tokens,
 * connector_sync_log.
 */

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'elite';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type AvatarMode = 'initials' | 'upload' | 'strava';
export type Sex = 'M' | 'F';

export type ConnectorProvider =
  | 'strava'
  | 'garmin'
  | 'apple_health'
  | 'coros'
  | 'polar'
  | 'suunto'
  | 'wahoo'
  | 'google_fit'
  | 'final_surge'
  | 'training_peaks'
  | 'whoop'
  | 'oura';

export interface UserRow {
  id: string;                    // UUID
  email: string;
  password_hash: string;         // bcrypt
  email_verified_at: Date | null;
  email_verify_token: string | null;
  email_verify_expires: Date | null;

  // Identity
  name: string;
  age: number | null;
  sex: Sex | null;
  location: string | null;

  // Avatar
  avatar_mode: AvatarMode;
  avatar_upload_url: string | null;
  avatar_strava_url: string | null;

  // Training prefs (drives buildPlan)
  level: Level;
  long_run_day: DayOfWeek;
  quality_days: DayOfWeek[];
  rest_day: DayOfWeek;

  // Audit
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_token: string;          // 32-byte base64url
  expires_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date;
}

export interface PasswordResetRow {
  id: string;
  user_id: string;
  token: string;                  // 32-byte base64url, single-use
  expires_at: Date;
  used_at: Date | null;
  ip_address: string | null;
  created_at: Date;
}

export interface ConnectorTokenRow {
  id: string;
  user_id: string;
  provider: ConnectorProvider;
  provider_user_id: string | null;
  scope: string | null;

  // OAuth credentials
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;

  // Provider-specific data
  metadata: Record<string, unknown>;

  // Sync status
  last_sync_at: Date | null;
  last_sync_status: 'success' | 'error' | 'in_progress' | 'rate_limited' | null;
  last_sync_error: string | null;
  activities_count: number;

  // Audit
  connected_at: Date;
  disconnected_at: Date | null;   // soft-delete; rows kept for audit
  updated_at: Date;
}

export interface ConnectorSyncLogRow {
  id: string;
  user_id: string;
  provider: ConnectorProvider;
  trigger: 'connect' | 'manual' | 'webhook' | 'cron' | 'backfill';
  status: 'success' | 'error' | 'in_progress' | 'rate_limited';
  activities_pulled: number;
  error_message: string | null;
  duration_ms: number | null;
  started_at: Date;
  finished_at: Date | null;
}

// ── Public projections — what we return to the client ──────────

/** Safe user shape: no password_hash, no verify tokens. */
export type PublicUser = Omit<
  UserRow,
  'password_hash' | 'email_verify_token' | 'email_verify_expires'
>;

/** Connector shape returned to /profile UI — no tokens. */
export type PublicConnector = Omit<
  ConnectorTokenRow,
  'access_token' | 'refresh_token'
>;
