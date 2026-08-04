CREATE TABLE projects (
  id serial PRIMARY KEY,
  name text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE queries (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'closed')),
  share_token text NOT NULL UNIQUE,
  answers_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX queries_project_id_idx ON queries (project_id);

CREATE TABLE questions (
  id serial PRIMARY KEY,
  query_id integer NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  position integer NOT NULL,
  text text NOT NULL,
  answer_text text,
  answered_at timestamptz
);
CREATE INDEX questions_query_id_idx ON questions (query_id);

CREATE TABLE attachments (
  id serial PRIMARY KEY,
  query_id integer REFERENCES queries(id) ON DELETE CASCADE,
  question_id integer REFERENCES questions(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL CHECK (uploaded_by IN ('admin', 'client')),
  filename text NOT NULL,
  stored_path text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((query_id IS NULL) <> (question_id IS NULL))
);
CREATE INDEX attachments_query_id_idx ON attachments (query_id);
CREATE INDEX attachments_question_id_idx ON attachments (question_id);
