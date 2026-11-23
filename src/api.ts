import type { CollectionName, WorkspaceState, BackupRecord, Entity } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(result?.error?.message ?? `操作失败（${response.status}）`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  return result.data as T;
}

export const api = {
  state: () => request<WorkspaceState>("/api/state"),
  search: (query: string) => request<Entity[]>(`/api/search?q=${encodeURIComponent(query)}`),
  create: (collection: CollectionName, input: Record<string, any>) =>
    request<Entity>(`/api/collections/${collection}`, { method: "POST", body: JSON.stringify(input) }),
  update: (collection: CollectionName, id: string, input: Record<string, any>) =>
    request<Entity>(`/api/collections/${collection}/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (collection: CollectionName, id: string) =>
    request<Entity>(`/api/collections/${collection}/${id}`, { method: "DELETE" }),
  restore: (collection: CollectionName, id: string) =>
    request<Entity>(`/api/collections/${collection}/${id}/restore`, { method: "POST" }),
  permanentDelete: (collection: CollectionName, id: string) =>
    request<void>(`/api/collections/${collection}/${id}/permanent`, { method: "DELETE" }),
  emptyTrash: () => request<{ deleted: number }>("/api/trash/permanent", { method: "DELETE" }),
  completePlan: (id: string) => request<Entity>(`/api/plan-items/${id}/complete`, { method: "POST" }),
  postponePlan: (id: string, date: string) =>
    request<Entity>(`/api/plan-items/${id}/postpone`, { method: "POST", body: JSON.stringify({ date }) }),
  getReview: (date: string) => request<Entity | null>(`/api/daily-reviews/${date}`),
  setReview: (date: string, content: string) =>
    request<Entity>(`/api/daily-reviews/${date}`, { method: "PUT", body: JSON.stringify({ content }) }),
  convertMemo: (id: string, collection: CollectionName, fields: Record<string, any>) =>
    request<Entity>(`/api/quick-memos/${id}/convert`, { method: "POST", body: JSON.stringify({ collection, fields }) }),
  settings: () => request<Record<string, any>>("/api/settings"),
  saveSettings: (input: Record<string, any>) => request<Record<string, any>>("/api/settings", { method: "PUT", body: JSON.stringify(input) }),
  systemStatus: () => request<Record<string, any>>("/api/system/status"),
  getAutostart: () => request<{ supported: boolean; enabled: boolean; command: string | null }>("/api/system/autostart"),
  setAutostart: (enabled: boolean) => request<{ supported: boolean; enabled: boolean; command: string | null }>("/api/system/autostart", { method: "PUT", body: JSON.stringify({ enabled }) }),
  saveNow: () => request<{ savedAt: string; database: string; dataFile: string }>("/api/system/save", { method: "POST" }),
  saveAndExit: () => request<{ savedAt: string; database: string; dataFile: string; exiting: boolean }>("/api/system/save-and-exit", { method: "POST" }),
  openDataDirectory: () => request<Record<string, any>>("/api/system/open-data-directory", { method: "POST" }),
  openPath: (path: string) => request<Record<string, any>>("/api/system/open-path", { method: "POST", body: JSON.stringify({ path }) }),
  openExplorer: () => request<Record<string, any>>("/api/system/open-explorer", { method: "POST", body: JSON.stringify({}) }),
  openControlPanel: () => request<Record<string, any>>("/api/system/open-control-panel", { method: "POST", body: JSON.stringify({}) }),
  shutdown: () => request<Record<string, any>>("/api/system/shutdown", { method: "POST", body: JSON.stringify({}) }),
  setWindowOpacity: (alpha: number) => request<{ alpha: number }>("/api/system/window-opacity", { method: "POST", body: JSON.stringify({ alpha }) }),
  getIcon: (path: string) => request<{ icon: string }>(`/api/system/icon?path=${encodeURIComponent(path)}`),
  resolveShortcut: (name: string, base64: string) => request<{ path: string; isDirectory?: boolean }>("/api/system/shortcut-target", { method: "POST", body: JSON.stringify({ name, base64 }) }),
  pickFolder: () => request<{ path: string }>("/api/system/pick-folder", { method: "POST", body: JSON.stringify({}) }),  pickFile: () => request<{ path: string }>("/api/system/pick-file", { method: "POST", body: JSON.stringify({}) }),
  findPath: (name: string) => request<{ path: string }>(`/api/system/find-path?name=${encodeURIComponent(name)}`),
  backups: () => request<BackupRecord[]>("/api/backups"),
  createBackup: (label = "", keep = false) => request<BackupRecord>("/api/backups", { method: "POST", body: JSON.stringify({ label, keep }) }),
  updateBackup: (id: string, input: { label?: string; keep?: boolean }) => request<BackupRecord>(`/api/backups/${id}/metadata`, { method: "PATCH", body: JSON.stringify(input) }),
  restoreBackup: (id: string) => request<{ restored: boolean }>(`/api/backups/${id}/restore`, { method: "POST" }),
  exportAll: () => request<{ filename: string; path: string; size: number; downloadUrl: string }>("/api/export", { method: "POST" }),
};
