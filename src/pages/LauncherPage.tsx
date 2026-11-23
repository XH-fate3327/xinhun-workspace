import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AppWindow, File, FolderSimple, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, EmptyState, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";
import { useModuleLabel } from "../useModuleLabel";
import type { Entity } from "../types";

type LauncherDraft = { id?: string; name: string; path: string; icon: string };

function kindOf(path: string): "folder" | "exe" | "file" {
  const value = path.trim();
  if (/\.(exe|lnk|bat|cmd)$/i.test(value)) return "exe";
  if (!/\.[a-z0-9]{1,8}$/i.test(value)) return "folder";
  return "file";
}

async function compressIcon(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取这张图片"));
      element.src = url;
    });
    const maxEdge = 256;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持图片处理");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LauncherPage() {
  const { data, run } = useWorkspace();
  const moduleLabel = useModuleLabel("启动台");
  const items = data.launcherItems;
  const order = useMemo<string[]>(() => {
    const value = data.settings.launcherOrder;
    return Array.isArray(value) ? (value as string[]) : [];
  }, [data.settings.launcherOrder]);
  const sorted = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = order.map((id) => byId.get(id)).filter((item): item is Entity => Boolean(item));
    const rest = items.filter((item) => !order.includes(item.id)).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    return [...ordered, ...rest];
  }, [items, order]);

  const [draft, setDraft] = useState<LauncherDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);

  const openItem = async (item: Entity) => {
    try {
      await api.openPath(String(item.path ?? ""));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const saveOrder = useCallback(async (next: Entity[]) => {
    await run(() => api.saveSettings({ launcherOrder: next.map((item) => item.id) }));
  }, [run]);

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const target = draft.path.trim();
    if (!name || !target) { setError("名称和路径都要填"); return; }
    setBusy(true); setError("");
    try {
      const kind = kindOf(target);
      if (draft.id) {
        await run(() => api.update("launcherItems", draft.id!, { name, path: target, icon: draft.icon, kind }));
      } else {
        const created = await run(() => api.create("launcherItems", { name, path: target, icon: draft.icon, kind }));
        await run(() => api.saveSettings({ launcherOrder: [...order, created.id] }));
      }
      setDraft(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const autoIcon = async () => {
    if (!draft) return;
    const target = draft.path.trim();
    if (!target) { setError("先填写路径"); return; }
    setBusy(true); setError("");
    try {
      const result = await api.getIcon(target);
      if (result.icon) setDraft((current) => (current ? { ...current, icon: result.icon } : current));
      else setError("没有取到图标（文件夹或该文件没有关联图标）");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onIconFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressIcon(file);
      setDraft((current) => (current ? { ...current, icon: dataUrl } : current));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const onDrop = (index: number) => async (event: DragEvent) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      const next = [...sorted];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      await saveOrder(next);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="launcher-page">
      <PageHeader
        icon={<ModuleArtwork module="launcher" />}
        eyebrow="工作"
        title={moduleLabel}
        description="把常用软件、文件夹放进来，一键快速打开；图标可自动取、也可自定义。"
        actions={<Button onClick={() => setDraft({ name: "", path: "", icon: "" })}><Plus size={17} />添加快捷方式</Button>}
      />
      <input ref={iconInput} type="file" accept="image/*" hidden onChange={onIconFile} />
      {error ? <div className="field-error">{error}</div> : null}
      {items.length === 0 ? (
        <EmptyState title="启动台还是空的" description="点右上角「添加快捷方式」，填入软件路径或文件夹路径即可。" />
      ) : (
        <div className="launcher-grid">
          {sorted.map((item, index) => {
            const kind = String(item.kind ?? kindOf(String(item.path ?? "")));
            return (
              <div
                key={item.id}
                className={classNames("launcher-item", dragIndex === index && "is-dragging", overIndex === index && dragIndex !== null && dragIndex !== index && "is-over")}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => { event.preventDefault(); setOverIndex(index); }}
                onDrop={(event) => void onDrop(index)(event)}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              >
                <button className="launcher-open" onClick={() => void openItem(item)} title={String(item.path ?? "")}>
                  <span className="launcher-icon">
                    {item.icon ? <img src={String(item.icon)} alt="" draggable={false} /> : kind === "folder" ? <FolderSimple size={34} /> : kind === "exe" ? <AppWindow size={34} /> : <File size={34} />}
                  </span>
                  <span className="launcher-name">{String(item.name ?? "")}</span>
                </button>
                <div className="launcher-tools">
                  <IconButton label="编辑" onClick={() => setDraft({ id: item.id, name: String(item.name ?? ""), path: String(item.path ?? ""), icon: String(item.icon ?? "") })}><PencilSimple size={14} /></IconButton>
                  <IconButton label="删除" onClick={() => void run(() => api.remove("launcherItems", item.id))}><Trash size={14} /></IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? "编辑快捷方式" : "添加快捷方式"}>
          <div className="launcher-form">
            <label className="launcher-field"><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：微信 / 我的项目文件夹" /></label>
            <label className="launcher-field"><span>路径</span><input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} placeholder="C:\Windows\notepad.exe 或 D:\工作\项目" /></label>
            <div className="launcher-icon-row">
              <div className="launcher-icon-preview">{draft.icon ? <img src={draft.icon} alt="" /> : <AppWindow size={30} />}</div>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => void autoIcon()}>自动取图标</Button>
              <Button variant="secondary" size="sm" onClick={() => iconInput.current?.click()}>上传图标</Button>
              {draft.icon ? <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, icon: "" })}>清除图标</Button> : null}
            </div>
            <p className="quiet-line">自定义图标只影响启动台显示，不改动软件本身图标。</p>
            <div className="launcher-form-actions">
              <Button variant="secondary" onClick={() => setDraft(null)}>取消</Button>
              <Button loading={busy} onClick={() => void saveDraft()}>保存</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
