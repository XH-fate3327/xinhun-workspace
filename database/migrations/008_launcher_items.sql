CREATE TABLE IF NOT EXISTS launcher_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'file',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_launcher_items_order ON launcher_items(created_at) WHERE deleted_at IS NULL;
