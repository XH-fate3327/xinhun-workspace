import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "./config.js";

export class DatabaseManager {
  private database!: Database.Database;

  constructor(
    public readonly paths: AppPaths,
    private readonly migrationsDir = path.resolve("database/migrations"),
  ) {
    this.open();
  }

  get db(): Database.Database {
    return this.database;
  }

  open(): void {
    this.database = new Database(this.paths.dataFile);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = FULL");
    this.migrate();
    // 每次启动让 SQLite 自行优化一次（统计信息/索引建议），开销很小
    try { this.database.pragma("optimize"); } catch { /* ignore */ }
  }

  close(): void {
    if (this.database?.open) {
      this.database.pragma("wal_checkpoint(TRUNCATE)");
      this.database.close();
    }
  }

  reopen(): void {
    this.close();
    this.open();
  }

  /** 数据体检：完整性检查 + optimize + VACUUM 回收空间 */
  maintenance(): { integrity: string; sizeBytes: number; freedBytes: number } {
    try { this.database.pragma("optimize"); } catch { /* ignore */ }
    const before = this.fileSize();
    const row = this.database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    try { this.database.exec("VACUUM"); } catch { /* ignore */ }
    try { this.database.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
    const after = this.fileSize();
    return {
      integrity: String(row?.integrity_check ?? "unknown"),
      sizeBytes: after,
      freedBytes: Math.max(0, before - after),
    };
  }

  private fileSize(): number {
    try { return fs.statSync(this.paths.dataFile).size; } catch { return 0; }
  }

  migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const applied = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
    const insert = this.database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");
    for (const file of files) {
      if (applied.get(file)) continue;
      const sql = fs.readFileSync(path.join(this.migrationsDir, file), "utf8");
      this.database.transaction(() => {
        this.database.exec(sql);
        insert.run(file, new Date().toISOString());
      })();
    }
    this.database.pragma("optimize");
  }

  checkpoint(): void {
    this.database.pragma("wal_checkpoint(TRUNCATE)");
  }

  integrityCheck(): string {
    const row = this.database.pragma("integrity_check", { simple: true });
    return String(row);
  }
}
