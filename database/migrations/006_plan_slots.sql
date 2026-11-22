CREATE TABLE IF NOT EXISTS plan_slots (
  id TEXT PRIMARY KEY,
  day_index INTEGER NOT NULL,
  slot_row INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'week',
  start_week TEXT NOT NULL,
  end_week TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]',
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_slots_pos ON plan_slots(day_index, slot_row) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS plan_completions (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_completions_week ON plan_completions(week, slot_id) WHERE deleted_at IS NULL;
