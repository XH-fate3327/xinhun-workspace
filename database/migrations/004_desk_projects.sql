CREATE TABLE IF NOT EXISTS desk_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  blocks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
