CREATE TABLE IF NOT EXISTS calendar_notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_notes_date ON calendar_notes(date) WHERE deleted_at IS NULL;
