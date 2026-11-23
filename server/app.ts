import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { z } from "zod";
import { getAppPaths, type AppPaths } from "./config.js";
import { DatabaseManager } from "./database.js";
import { AppStore, NotFoundError, ValidationError } from "./store.js";
import { BackupManager } from "./backup.js";
import { collectionDefinitions, isCollectionName, sourceCollectionByType } from "./collections.js";
import { openPathCommand } from "./platform.js";

const bodySchema = z.record(z.string(), z.unknown());

// ——— 开机自启（Windows 注册表 HKCU\Software\Microsoft\Windows\CurrentVersion\Run） ———
const AUTOSTART_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTOSTART_VALUE = "XinhunWorkspace";

function launcherCommand(dataRoot: string): string | null {
  if (process.platform !== "win32") return null;
  const appRoot = path.dirname(dataRoot);
  for (const name of ["心魂工作台.exe", "启动心魂工作台.bat"]) {
    const candidate = path.join(appRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readAutostart(dataRoot: string): { supported: boolean; enabled: boolean; command: string | null } {
  if (process.platform !== "win32") return { supported: false, enabled: false, command: null };
  const launcher = launcherCommand(dataRoot);
  try {
    // 只判断值是否存在；命令路径直接用计算值，避免 reg.exe 输出编码（GBK）导致中文乱码
    execFileSync("reg", ["query", AUTOSTART_KEY, "/v", AUTOSTART_VALUE], { encoding: "utf8", windowsHide: true });
    return { supported: true, enabled: true, command: launcher };
  } catch {
    return { supported: true, enabled: false, command: launcher };
  }
}

function setAutostart(dataRoot: string, enabled: boolean): void {
  if (process.platform !== "win32") throw new ValidationError("当前系统不支持开机自启");
  if (enabled) {
    const command = launcherCommand(dataRoot);
    if (!command) throw new ValidationError("未找到启动器（心魂工作台.exe）");
    execFileSync("reg", ["add", AUTOSTART_KEY, "/v", AUTOSTART_VALUE, "/t", "REG_SZ", "/d", `"${command}"`, "/f"], { encoding: "utf8", windowsHide: true });
  } else {
    try {
      execFileSync("reg", ["delete", AUTOSTART_KEY, "/v", AUTOSTART_VALUE, "/f"], { encoding: "utf8", windowsHide: true });
    } catch {
      // 本来就不存在，忽略
    }
  }
}

export type BuildAppOptions = {
  dataDir?: string;
  logger?: boolean;
  serveStatic?: boolean;
  autoBackup?: boolean;
  requestShutdown?: (reason: "user-exit") => void;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const paths = getAppPaths(options.dataDir);
  const manager = new DatabaseManager(paths);
  const store = new AppStore(manager);
  const backups = new BackupManager(manager, store, paths);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return reply.code(403).send({ error: { code: "INVALID_ORIGIN", message: "请求来源无效" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const appError = error as Error & { statusCode?: number };
    const statusCode = error instanceof ValidationError || error instanceof NotFoundError
      ? error.statusCode
      : appError.statusCode && Number(appError.statusCode) < 500
        ? Number(appError.statusCode)
        : 500;
    const message = statusCode >= 500 ? `操作失败：${appError.message}` : appError.message;
    reply.code(statusCode).send({ error: { code: appError.name || "APP_ERROR", message } });
  });

  app.get("/api/health", async () => ({
    data: {
      application: "xinhun-workspace",
      buildId: process.env.MUZI_BUILD_ID ?? "development",
      instanceId: process.env.MUZI_INSTANCE_ID ?? null,
      status: "ok",
      database: manager.integrityCheck(),
      schemaVersion: latestSchemaVersion(manager),
      now: new Date().toISOString(),
    },
  }));

  app.get("/api/state", async () => ({ data: store.state() }));


  app.get("/api/search", async (request) => {
    const query = request.query as { q?: string };
    return { data: store.search(query.q ?? "") };
  });

  app.get("/api/collections/:collection", async (request) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const query = request.query as { includeDeleted?: string };
    return { data: store.list(collection, query.includeDeleted === "true") };
  });

  app.post("/api/collections/:collection", async (request, reply) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const input = bodySchema.parse(request.body ?? {});
    const entity = store.create(collection, input);
    return reply.code(201).send({ data: entity });
  });

  app.patch("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.update(collection, id, bodySchema.parse(request.body ?? {})) };
  });

  app.delete("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.softDelete(collection, id) };
  });

  app.post("/api/collections/:collection/:id/restore", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.restore(collection, id) };
  });

  app.delete("/api/collections/:collection/:id/permanent", async (request, reply) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    store.permanentDelete(collection, id);
    return reply.code(204).send();
  });

  app.post("/api/plan-items/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    const item = store.get("planItems", id);
    const now = new Date().toISOString();
    const updated = store.update("planItems", id, { status: "done", completed_at: now });
    if (item.complete_source && item.source_entity_type && item.source_entity_id) {
      const collection = sourceCollectionByType[item.source_entity_type];
      if (collection) {
        const statusField = collection === "workouts" ? "completed" : "done";
        const definition = collectionDefinitions[collection];
        if (definition.fields.includes("status" as never)) {
          store.update(collection, item.source_entity_id, { status: statusField });
        }
      }
    }
    return { data: updated };
  });

  app.post("/api/plan-items/:id/postpone", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.body);
    return { data: store.update("planItems", id, { plan_date: body.date, status: "todo", completed_at: null }) };
  });

  app.get("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    return { data: store.getDailyReview(date) };
  });

  app.put("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    const body = z.object({ content: z.string() }).parse(request.body);
    return { data: store.setDailyReview(date, body.content) };
  });

  app.post("/api/quick-memos/:id/convert", async (request) => {
    const { id } = request.params as { id: string };
    const memo = store.get("quickMemos", id);
    const body = z.object({ collection: z.string(), fields: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    assertCollection(body.collection);
    const titleField = collectionDefinitions[body.collection].title;
    const converted = store.create(body.collection, {
      ...body.fields,
      [titleField]: body.fields[titleField] ?? memo.content,
    });
    store.update("quickMemos", id, { converted_type: body.collection, converted_id: converted.id, archived_at: new Date().toISOString() });
    return { data: converted };
  });

  app.get("/api/settings", async () => ({ data: store.getSettings() }));
  app.put("/api/settings", async (request) => ({ data: store.setSettings(bodySchema.parse(request.body ?? {})) }));
  app.get("/api/trash", async () => ({ data: store.trash() }));
  app.delete("/api/trash/permanent", async () => ({ data: { deleted: store.permanentDeleteAll() } }));

  app.get("/api/system/status", async () => ({ data: systemStatus(paths, backups) }));
  app.get("/api/system/data-file", async () => ({ data: fileInfo(paths.dataFile) }));
  const saveDataFile = () => {
    manager.checkpoint();
    const database = manager.integrityCheck();
    if (database !== "ok") throw new Error("数据库完整性检查失败");
    return { savedAt: new Date().toISOString(), database, dataFile: paths.dataFile };
  };
  app.post("/api/system/save", async () => {
    return { data: saveDataFile() };
  });
  app.post("/api/system/save-and-exit", async (_request, reply) => {
    const saved = saveDataFile();
    if (options.requestShutdown) {
      reply.raw.once("finish", () => {
        const timer = setTimeout(() => options.requestShutdown?.("user-exit"), 50);
        timer.unref();
      });
    }
    return reply.send({ data: { ...saved, exiting: Boolean(options.requestShutdown) } });
  });
  app.post("/api/system/open-data-directory", async () => {
    openPath(paths.root);
    return { data: { opened: true, path: paths.root } };
  });
  app.post("/api/system/open-path", async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    if (!fs.existsSync(body.path)) throw new ValidationError("这个本地路径不存在");
    openPath(path.resolve(body.path));
    return { data: { opened: true } };
  });

  // 打开「此电脑」资源管理器
  app.post("/api/system/open-explorer", async () => {
    const child = spawn("explorer.exe", ["shell:MyComputerFolder"], { detached: true, stdio: "ignore" });
    child.unref();
    bringToFront(child.pid ?? 0, "此电脑");
    return { data: { opened: true } };
  });

  // 当前 Windows 桌面壁纸（背景透明功能用）
  app.get("/api/system/wallpaper", async (_request, reply) => {
    const candidates = [
      path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Themes", "TranscodedWallpaper"),
      path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Themes", "TranscodedWallpaper"),
    ];
    let file = candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? "";
    if (!file) {
      try {
        const out = execFileSync("reg", ["query", "HKCU\\Control Panel\\Desktop", "/v", "Wallpaper"], { encoding: "utf8", windowsHide: true });
        const match = out.match(/Wallpaper\s+REG_SZ\s+(.+)/);
        if (match) {
          const value = match[1].trim();
          if (fs.existsSync(value)) file = value;
        }
      } catch { /* ignore */ }
    }
    if (!file) return reply.code(404).send("no wallpaper");
    return reply.type("image/jpeg").send(fs.readFileSync(file));
  });

  // 应用窗口整体透明度（背景透明功能用：浏览器窗口无法局部透明，用整窗 alpha 近似）
  app.post("/api/system/window-opacity", async (request) => {
    const body = z.object({ alpha: z.number().int().min(30).max(255) }).parse(request.body ?? {});
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class XOpacity {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
}
"@
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq '心魂工作台' } | Select-Object -First 1
if ($p) {
  $h = $p.MainWindowHandle
  $ex = [XOpacity]::GetWindowLong($h, -20)
  [XOpacity]::SetWindowLong($h, -20, $ex -bor 0x80000) | Out-Null
  [XOpacity]::SetLayeredWindowAttributes($h, 0, ${body.alpha}, 2) | Out-Null
}
`;
    execFile("powershell", ["-NoProfile", "-Command", script], { windowsHide: true }, () => undefined);
    return { data: { alpha: body.alpha } };
  });

  // 打开「控制面板」
  app.post("/api/system/open-control-panel", async () => {
    const child = spawn("explorer.exe", ["shell:ControlPanelFolder"], { detached: true, stdio: "ignore" });
    child.unref();
    bringToFront(child.pid ?? 0, "控制面板");
    return { data: { opened: true } };
  });

  // 关机（10 秒倒计时，可 shutdown /a 取消）
  app.post("/api/system/shutdown", async () => {
    const child = spawn("shutdown.exe", ["/s", "/t", "10"], { detached: true, stdio: "ignore" });
    child.unref();
    return { data: { scheduled: true } };
  });

  // 从本地 exe / 文件提取关联图标（启动台默认图标用）
  app.get("/api/system/icon", async (request) => {
    const query = request.query as { path?: string };
    const target = String(query.path ?? "").trim();
    if (!target || process.platform !== "win32" || !fs.existsSync(target)) return { data: { icon: "" } };
    try {
      const escaped = path.resolve(target).replace(/'/g, "''");
      const script = [
        "Add-Type -AssemblyName System.Drawing;",
        `$p = '${escaped}';`,
        "if (Test-Path -LiteralPath $p) {",
        "  $i = [System.Drawing.Icon]::ExtractAssociatedIcon($p);",
        "  if ($i) { $b = $i.ToBitmap(); $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }",
        "}",
      ].join(" ");
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const base64 = out.trim();
      return { data: { icon: base64 ? `data:image/png;base64,${base64}` : "" } };
    } catch {
      return { data: { icon: "" } };
    }
  });

  // 按名字在常见位置反查路径（浏览器拖入文件夹/文件时拿不到完整路径）
  app.get("/api/system/find-path", async (request) => {
    const query = request.query as { name?: string };
    const name = String(query.name ?? "").trim();
    if (!name || name.includes("\\") || name.includes("/")) return { data: { path: "" } };
    const home = os.homedir();
    const roots = [
      path.join(home, "Desktop"),
      path.join(home, "OneDrive", "Desktop"),
      path.join(home, "OneDrive", "桌面"),
      path.join(home, "Documents"),
      path.join(home, "Downloads"),
      home,
      "D:\\",
    ];
    for (const root of roots) {
      const candidate = path.join(root, name);
      try {
        if (fs.existsSync(candidate)) return { data: { path: candidate } };
      } catch { /* ignore */ }
    }
    return { data: { path: "" } };
  });

  // 原生「选择文件夹 / 选择文件」对话框（浏览器拿不到本地路径时用）
  app.post("/api/system/pick-folder", async () => {
    if (process.platform !== "win32") return { data: { path: "" } };
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = '选择要添加的文件夹'",
      "$d.ShowNewFolderButton = $false",
      "$r = $d.ShowDialog()",
      "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }",
    ].join("; ");
    const path = await new Promise<string>((resolve) => {
      execFile("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 180000 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
    });
    return { data: { path } };
  });

  app.post("/api/system/pick-file", async () => {
    if (process.platform !== "win32") return { data: { path: "" } };
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.OpenFileDialog",
      "$d.Title = '选择程序或文件'",
      "$d.Filter = '程序 (*.exe)|*.exe|所有文件 (*.*)|*.*'",
      "$r = $d.ShowDialog()",
      "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }",
    ].join("; ");
    const path = await new Promise<string>((resolve) => {
      execFile("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 180000 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
    });
    return { data: { path } };
  });

  app.get("/api/system/autostart", async () => ({ data: readAutostart(paths.root) }));
  app.put("/api/system/autostart", async (request) => {
    const body = z.object({ enabled: z.boolean() }).parse(request.body ?? {});
    setAutostart(paths.root, body.enabled);
    return { data: readAutostart(paths.root) };
  });

  // 解析 .lnk / .url 快捷方式的目标路径（拖动快捷方式到启动台时用）
  app.post("/api/system/shortcut-target", async (request) => {
    const body = z.object({ name: z.string().min(1), base64: z.string().min(1) }).parse(request.body ?? {});
    if (process.platform !== "win32") return { data: { path: "" } };
    const temp = path.join(os.tmpdir(), `xinhun-${Date.now()}-${path.basename(body.name)}`);
    try {
      fs.writeFileSync(temp, Buffer.from(body.base64, "base64"));
      if (/\.url$/i.test(body.name)) {
        const text = fs.readFileSync(temp, "utf8");
        const match = text.match(/^\s*URL\s*=\s*(.+)$/im);
        return { data: { path: match ? match[1].trim() : "" } };
      }
      const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (New-Object -ComObject WScript.Shell).CreateShortcut('${temp.replace(/'/g, "''")}').TargetPath`;
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const target = out.trim();
      let isDirectory = false;
      try { isDirectory = Boolean(target) && fs.statSync(target).isDirectory(); } catch { isDirectory = false; }
      return { data: { path: target, isDirectory } };
    } catch {
      return { data: { path: "" } };
    } finally {
      try { fs.unlinkSync(temp); } catch { /* ignore */ }
    }
  });

  app.get("/api/backups", async () => ({ data: backups.list() }));
  app.post("/api/backups", async (request, reply) => {
    const body = z.object({ label: z.string().default(""), keep: z.boolean().default(false) }).parse(request.body ?? {});
    const backup = await backups.create("manual", body.label, body.keep);
    return reply.code(201).send({ data: backup });
  });
  app.patch("/api/backups/:id/metadata", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ label: z.string().optional(), keep: z.boolean().optional() }).parse(request.body ?? {});
    return { data: backups.updateMetadata(id, body) };
  });
  app.post("/api/backups/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    await backups.restore(id);
    return { data: { restored: true } };
  });

  app.post("/api/export", async (_request, reply) => {
    const result = await backups.exportAll();
    return reply.code(201).send({ data: { ...result, downloadUrl: `/api/exports/${encodeURIComponent(result.filename)}` } });
  });
  app.get("/api/exports/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (path.basename(filename) !== filename) throw new ValidationError("导出文件路径无效");
    const file = path.resolve(paths.exportsDir, filename);
    if (!file.startsWith(`${path.resolve(paths.exportsDir)}${path.sep}`) || !fs.existsSync(file)) throw new NotFoundError("没有找到导出文件");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.type("application/zip");
    return reply.send(fs.createReadStream(file));
  });

  if (options.serveStatic ?? process.env.NODE_ENV === "production") {
    const root = path.resolve("dist");
    await app.register(fastifyStatic, {
      root,
      wildcard: true,
      setHeaders: (response, filePath) => {
        response.setHeader(
          "Cache-Control",
          filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
      // 缺失的构建资源必须返回 404。若退回 index.html，浏览器会把 HTML
      // 当作 JavaScript/CSS 加载并得到一片白屏。
      if (request.url.startsWith("/assets/")) {
        return reply.code(404).send({ error: { code: "ASSET_NOT_FOUND", message: "页面资源不存在，请重新启动心魂工作台" } });
      }
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => manager.close());

  if (options.autoBackup ?? process.env.NODE_ENV !== "test") {
    void backups.ensureDailyBackup().catch((error) => app.log.error(error, "自动备份失败"));
  }

  return app;
}

function assertCollection(value: string): asserts value is keyof typeof collectionDefinitions {
  if (!isCollectionName(value)) throw new NotFoundError("模块不存在");
}

function latestSchemaVersion(manager: DatabaseManager): string | null {
  const row = manager.db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: string } | undefined;
  return row?.version ?? null;
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function fileInfo(file: string): Record<string, any> {
  const stat = fs.statSync(file);
  let writable = true;
  try {
    fs.accessSync(file, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  return { path: file, size: stat.size, modifiedAt: stat.mtime.toISOString(), writable };
}

function systemStatus(paths: AppPaths, backups: BackupManager): Record<string, any> {
  return {
    dataFile: fileInfo(paths.dataFile),
    dataDirectory: paths.root,
    backupsDirectory: paths.backupsDir,
    exportsDirectory: paths.exportsDir,
    latestBackup: backups.list()[0] ?? null,
    backupStatus: backups.getStatus(),
  };
}

function openPath(target: string): void {
  const { command, args } = openPathCommand(target);
  // 不能带 windowsHide，否则 explorer 打开的文件夹窗口也会被隐藏
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  bringToFront(child.pid ?? 0, path.basename(target));
}

function bringToFront(pid: number, titleHint: string): void {
  const safeTitle = String(titleHint).replace(/'/g, "''");
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class XinhunBring {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
}
"@
Start-Sleep -Milliseconds 700
$h = [IntPtr]::Zero
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) { $h = $p.MainWindowHandle }
if ($h -eq [IntPtr]::Zero) {
  $w = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${safeTitle}*' } | Select-Object -First 1
  if ($w) { $h = $w.MainWindowHandle }
}
if ($h -ne [IntPtr]::Zero) {
  $fg = [XinhunBring]::GetForegroundWindow()
  $fgPid = [uint32]0
  $fgThread = [XinhunBring]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $cur = [XinhunBring]::GetCurrentThreadId()
  if ($fgThread -ne 0) { [XinhunBring]::AttachThreadInput($cur, $fgThread, $true) | Out-Null }
  [XinhunBring]::ShowWindow($h, 9) | Out-Null
  [XinhunBring]::ShowWindow($h, 5) | Out-Null
  [XinhunBring]::BringWindowToTop($h) | Out-Null
  [XinhunBring]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 3) | Out-Null
  [XinhunBring]::SetForegroundWindow($h) | Out-Null
  if ($fgThread -ne 0) { [XinhunBring]::AttachThreadInput($cur, $fgThread, $false) | Out-Null }
}
`;
  execFile("powershell", ["-NoProfile", "-Command", script], { windowsHide: true }, () => undefined);
}
