-- Contract Check-In: initial schema
-- Colors are stored as 'green' | 'yellow' | 'red'.

CREATE TABLE crps (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  call_schedule TEXT NOT NULL DEFAULT 'biweekly'
                CHECK (call_schedule IN ('weekly', 'biweekly', 'monthly')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who can use the app. A person's login email is matched to a row here.
-- role: 'supervisor' (works their CRP's contracts), 'crp_admin' (also manages
-- their CRP's people and settings), 'wvarf_admin' (statewide view + all admin).
CREATE TABLE members (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  crp_id      INTEGER REFERENCES crps(id) ON DELETE SET NULL,
  role        TEXT NOT NULL DEFAULT 'supervisor'
              CHECK (role IN ('supervisor', 'crp_admin', 'wvarf_admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id                 SERIAL PRIMARY KEY,
  crp_id             INTEGER NOT NULL REFERENCES crps(id) ON DELETE CASCADE,
  contract_number    TEXT NOT NULL,
  name               TEXT NOT NULL,
  agreement_type     TEXT NOT NULL DEFAULT 'state'
                     CHECK (agreement_type IN ('state', 'other')),
  contact1_name      TEXT,
  contact1_phone     TEXT,
  contact2_name      TEXT,
  contact2_phone     TEXT,
  site_supervisor    TEXT,
  scope_link         TEXT,
  checklist_link     TEXT,
  current_color      TEXT CHECK (current_color IN ('green', 'yellow', 'red')),
  color_since        TIMESTAMPTZ,
  last_called_at     TIMESTAMPTZ,
  last_visited_at    TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crp_id, contract_number)
);

CREATE INDEX contracts_crp_idx ON contracts (crp_id);
CREATE INDEX contracts_state_idx ON contracts (agreement_type);

CREATE TABLE calls (
  id           SERIAL PRIMARY KEY,
  contract_id  INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  called_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_by    TEXT NOT NULL,
  spoke_with   TEXT,
  what_they_said TEXT,
  no_answer    BOOLEAN NOT NULL DEFAULT FALSE,
  color        TEXT CHECK (color IN ('green', 'yellow', 'red'))
);

CREATE INDEX calls_contract_idx ON calls (contract_id, called_at DESC);

CREATE TABLE visits (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  visit_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  visited_by          TEXT NOT NULL,
  met_with            TEXT,
  color_at_visit      TEXT CHECK (color_at_visit IN ('green', 'yellow', 'red')),
  walkthrough_notes   TEXT,
  scope_reviewed      BOOLEAN,
  checklist_reviewed  BOOLEAN,
  root_causes         TEXT[] NOT NULL DEFAULT '{}',
  action_taken        TEXT,
  employees_coached   TEXT,
  followup_date       DATE,
  customer_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
  new_color           TEXT CHECK (new_color IN ('green', 'yellow', 'red')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visits_contract_idx ON visits (contract_id, visit_date DESC);
