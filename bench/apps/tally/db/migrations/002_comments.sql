CREATE TABLE comments (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
