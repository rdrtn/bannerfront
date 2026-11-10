-- Fase 0: usuários, sessões, projetos, fontes e auditoria.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'designer', 'operacional', 'atendimento')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  client         text,
  subject        text,
  kind           text NOT NULL CHECK (kind IN ('basic', 'advanced')),
  format_id      text NOT NULL,
  width          integer NOT NULL CHECK (width > 0),
  height         integer NOT NULL CHECK (height > 0),
  schema_version integer NOT NULL,
  -- Concorrência otimista: cada gravação exige a versão que o cliente leu.
  version        integer NOT NULL DEFAULT 1,
  data           jsonb NOT NULL,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_updated_idx ON projects (updated_at DESC);

CREATE TABLE fonts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family            text NOT NULL,
  style             text NOT NULL,
  weight            integer NOT NULL,
  italic            boolean NOT NULL DEFAULT false,
  format            text NOT NULL CHECK (format IN ('ttf', 'otf', 'woff')),
  file_name         text NOT NULL,
  sha256            text NOT NULL UNIQUE,
  bytes             integer NOT NULL,
  glyph_count       integer NOT NULL,
  source            text NOT NULL CHECK (source IN ('upload', 'google')),
  license_confirmed boolean NOT NULL,
  license_origin    text,
  uploaded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fonts_family_idx ON fonts (lower(family));

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
