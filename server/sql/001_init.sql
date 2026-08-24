-- Travelers World Map — user store (document 4 §3.2, §12).
-- Place data is static files. This database holds only what a traveler owns:
-- visit / trip / trip_place / profile, plus the identities that attach to one
-- user. There is no places table, no coordinates, no score.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_user (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email and Google are linked identities on one user (doc 5 §6). A further
-- provider attaches to the same user rather than creating a second.
CREATE TABLE identity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('email', 'google')),
  subject     TEXT NOT NULL,
  email       TEXT,
  UNIQUE (provider, subject)
);

CREATE INDEX identity_email_lower ON identity (lower(email));

CREATE TABLE session (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE magic_link (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- One row per marked place. Unmarking sets visited = false. A visit row is
-- never DELETE'd to unmark, so a note survives an accidental tap (P4, doc 4
-- §3.2). Account deletion (doc 5 §6) removes the user and cascades.
CREATE TABLE visit (
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL,
  visited     BOOLEAN NOT NULL,
  marked_at   TIMESTAMPTZ NOT NULL,
  visited_on  DATE,
  note        TEXT,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE trip (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  start_date  DATE,
  end_date    DATE,
  day_count   INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordering by position, never by array index (doc 4 §3.2, §8).
CREATE TABLE trip_place (
  trip_id     TEXT NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL,
  day_index   INT NOT NULL,
  position    INT NOT NULL,
  PRIMARY KEY (trip_id, place_id)
);

CREATE TABLE profile (
  user_id       UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  display_name  TEXT,
  home_country  TEXT,
  units         TEXT,
  theme         TEXT
);

CREATE TABLE place_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES app_user(id) ON DELETE SET NULL,
  place_id    TEXT NOT NULL,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row-level security at the database, not only in the API (doc 4 §12).
ALTER TABLE visit ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_place ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY visit_owner ON visit
  USING (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

CREATE POLICY trip_owner ON trip
  USING (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

CREATE POLICY trip_place_owner ON trip_place
  USING (EXISTS (
    SELECT 1 FROM trip t
    WHERE t.id = trip_id
      AND t.user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM trip t
    WHERE t.id = trip_id
      AND t.user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid
  ));

CREATE POLICY profile_owner ON profile
  USING (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

CREATE POLICY identity_owner ON identity
  USING (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

CREATE POLICY session_owner ON session
  USING (user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

CREATE POLICY feedback_owner ON place_feedback
  USING (user_id IS NULL OR user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid)
  WITH CHECK (user_id IS NULL OR user_id = NULLIF(current_setting('twm.user_id', true), '')::uuid);

-- Application role: RLS applies. Table owner (migrations) bypasses it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twm_app') THEN
    CREATE ROLE twm_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO twm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app_user, identity, session, magic_link, visit, trip, trip_place, profile, place_feedback
  TO twm_app;
