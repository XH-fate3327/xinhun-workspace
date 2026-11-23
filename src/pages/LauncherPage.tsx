import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AppWindow, File, FolderSimple, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, EmptyState, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";
import { useModuleLabel } from "../useModuleLabel";
import type { Entity } from "../types";

type LauncherDraft = { id?: string; name: string; path: string; icon: string; category: string };
type Category = { id: string; name: string };

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

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function LauncherPage() {
  const { data, run } = useWorkspace();
  const moduleLabel = useModuleLabel("启动台");
  const items = data.launcherItems;
  const order = useMemo<string[]>(() => {
    const value = data.settings.launcherOrder;
    return Array.isArray(value) ? (value as string[]) : [];
  }, [data.settings.launcherOrder]);
  const categories = useMemo<Category[]>(() => {
    const value = data.settings.launcherCategories;
    return Array.isArray(value) ? (value as Category[]) : [];
  }, [data.settings.launcherCategories]);

  const sorted = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = order.map((id) => byId.get(id)).filter((item): item is Entity => Boolean(item));
    const rest = items.filter((item) => !order.includes(item.id)).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    return [...ordered, ...rest];
  }, [items, order]);

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const visible = useMemo(() => {
    if (activeCategory === "all") return sorted;
    return sorted.filter((item) => String(item.category ?? "") === activeCategory);
  }, [sorted, activeCategory]);

  const [draft, setDraft] = useState<LauncherDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<{ id?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [catDragIndex, setCatDragIndex] = useState<number | null>(null);
  const [catOverIndex, setCatOverIndex] = useState<number | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{ id: string; name: string } | null>(null);
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

  const onCategoryReorder = (index: number) => async (event: DragEvent) => {
    event.preventDefault();
    if (catDragIndex !== null && catDragIndex !== index) {
      const next = [...categories];
      const [moved] = next.splice(catDragIndex, 1);
      next.splice(index, 0, moved);
      await run(() => api.saveSettings({ launcherCategories: next }));
    }
    setCatDragIndex(null);
    setCatOverIndex(null);
  };

  const addItemFromPath = async (name: string, target: string) => {
    let icon = "";
    try { icon = (await api.getIcon(target)).icon; } catch { icon = ""; }
    const created = await run(() => api.create("launcherItems", { name, path: target, icon, kind: kindOf(target), category: activeCategory === "all" ? "" : activeCategory }));
    await run(() => api.saveSettings({ launcherOrder: [...order, created.id] }));
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const target = draft.path.trim();
    if (!name || !target) { setError("名称和路径都要填"); return; }
    setBusy(true); setError("");
    try {
      const kind = kindOf(target);
      if (draft.id) {
        await run(() => api.update("launcherItems", draft.id!, { name, path: target, icon: draft.icon, kind, category: draft.category }));
      } else {
        const created = await run(() => api.create("launcherItems", { name, path: target, icon: draft.icon, kind, category: draft.category }));
        await run(() => api.saveSettings({ launcherOrder: [...order, created.id] }));
      }
      setDraft(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCategory = async () => {
    if (!categoryDraft) return;
    const name = categoryDraft.name.trim();
    if (!name) { setError("分类夹要有个名字"); return; }
    const next = categoryDraft.id
      ? categories.map((category) => (category.id === categoryDraft.id ? { ...category, name } : category))
      : [...categories, { id: (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)), name }];
    await run(() => api.saveSettings({ launcherCategories: next }));
    setCategoryDraft(null);
  };

  const removeCategory = async (id: string) => {
    const next = categories.filter((category) => category.id !== id);
    await run(() => api.saveSettings({ launcherCategories: next }));
    for (const item of items.filter((entry) => String(entry.category ?? "") === id)) {
      await run(() => api.update("launcherItems", item.id, { category: "" }));
    }
    if (activeCategory === id) setActiveCategory("all");
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

  const onDropFiles = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) return;
    setBusy(true); setError("");
    try {
      for (const file of files) {
        if (/\.(lnk|url)$/i.test(file.name)) {
          const base64 = await fileToBase64(file);
          const result = await api.resolveShortcut(file.name, base64);
          if (result.path) {
            await addItemFromPath(file.name.replace(/\.(lnk|url)$/i, ""), result.path);
          } else {
            setError("无法解析这个快捷方式的目标路径");
          }
        } else {
          setError("浏览器无法直接拿到文件/文件夹路径，请拖入 .lnk 快捷方式，或点右上角手动填写路径。");
        }
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReorder = (index: number) => async (event: DragEvent) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      const visibleIds = visible.map((item) => item.id);
      const [movedId] = visibleIds.splice(dragIndex, 1);
      visibleIds.splice(index, 0, movedId);
      let cursor = 0;
      const nextOrder = sorted.map((item) => (visibleIds.includes(item.id) ? visibleIds[cursor++] : item.id));
      const byId = new Map(sorted.map((item) => [item.id, item]));
      await saveOrder(nextOrder.map((id) => byId.get(id)).filter((item): item is Entity => Boolean(item)));
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="launcher-page" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void onDropFiles(event)}>
      <PageHeader
        icon={<ModuleArtwork module="launcher" />}
        eyebrow="工作"
        title={moduleLabel}
        description="把常用软件、文件夹放进来，一键快速打开；也可以拖动 .lnk 快捷方式直接添加。"
        actions={<Button onClick={() => setDraft({ name: "", path: "", icon: "", category: activeCategory === "all" ? "" : activeCategory })}><Plus size={17} />添加快捷方式</Button>}
      />
      <input ref={iconInput} type="file" accept="image/*" hidden onChange={onIconFile} />
      {error ? <div className="field-error">{error}</div> : null}

      <div className="launcher-categories">
        <button className={classNames("launcher-category", activeCategory === "all" && "active")} onClick={() => setActiveCategory("all")}>
          <strong>全部</strong><small>{items.length}</small>
        </button>
        {categories.map((category, index) => (
          <div
            key={category.id}
            className={classNames("launcher-category", "is-draggable", activeCategory === category.id && "active", catDragIndex === index && "is-dragging", catOverIndex === index && catDragIndex !== null && catDragIndex !== index && "is-over")}
            draggable
            onDragStart={() => setCatDragIndex(index)}
            onDragOver={(event) => { event.preventDefault(); setCatOverIndex(index); }}
            onDrop={(event) => void onCategoryReorder(index)(event)}
            onDragEnd={() => { setCatDragIndex(null); setCatOverIndex(null); }}
            onContextMenu={(event) => { event.preventDefault(); setCategoryMenu({ id: category.id, name: category.name }); }}
            title={`${category.name}（右键修改/删除，拖动调整顺序）`}
          >
            <button className="launcher-category-main" onClick={() => setActiveCategory(category.id)}>
              <strong>{category.name}</strong><small>{items.filter((item) => String(item.category ?? "") === category.id).length}</small>
            </button>
          </div>
        ))}
        <button className="launcher-category launcher-category-add" onClick={() => setCategoryDraft({ name: "" })}><Plus size={15} />新建分类夹</button>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="这里还没有快捷方式" description="点右上角「添加快捷方式」，或把桌面的 .lnk 快捷方式直接拖进来。" />
      ) : (
        <div className="launcher-grid">
          {visible.map((item, index) => {
            const kind = String(item.kind ?? kindOf(String(item.path ?? "")));
            return (
              <div
                key={item.id}
                className={classNames("launcher-item", dragIndex === index && "is-dragging", overIndex === index && dragIndex !== null && dragIndex !== index && "is-over")}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => { event.preventDefault(); setOverIndex(index); }}
                onDrop={(event) => void onReorder(index)(event)}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              >
                <button className="launcher-open" onClick={() => void openItem(item)} title={String(item.path ?? "")}>
                  <span className="launcher-icon">
                    {item.icon ? <img src={String(item.icon)} alt="" draggable={false} /> : kind === "folder" ? <FolderSimple size={34} /> : kind === "exe" ? <AppWindow size={34} /> : <File size={34} />}
                  </span>
                  <span className="launcher-name">{String(item.name ?? "")}</span>
                </button>
                <div className="launcher-tools">
                  <IconButton label="编辑" onClick={() => setDraft({ id: item.id, name: String(item.name ?? ""), path: String(item.path ?? ""), icon: String(item.icon ?? ""), category: String(item.category ?? "") })}><PencilSimple size={14} /></IconButton>
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
            <label className="launcher-field"><span>分类夹</span>
              <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                <option value="">未分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
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

      {categoryDraft ? (
        <Modal open onClose={() => setCategoryDraft(null)} title={categoryDraft.id ? "重命名分类夹" : "新建分类夹"}>
          <div className="launcher-form">
            <label className="launcher-field"><span>分类夹名称</span><input autoFocus value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") void saveCategory(); }} placeholder="例如：游戏 / 工作工具" /></label>
            <div className="launcher-form-actions">
              <Button variant="secondary" onClick={() => setCategoryDraft(null)}>取消</Button>
              <Button onClick={() => void saveCategory()}>保存</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {categoryMenu ? (
        <Modal open onClose={() => setCategoryMenu(null)} title={`分类夹：${categoryMenu.name}`}>
          <div className="launcher-form">
            <Button variant="secondary" onClick={() => { setCategoryDraft({ id: categoryMenu.id, name: categoryMenu.name }); setCategoryMenu(null); }}><PencilSimple size={15} />重命名</Button>
            <Button variant="ghost" className="danger-text" onClick={() => { void removeCategory(categoryMenu.id); setCategoryMenu(null); }}><Trash size={15} />删除这个分类夹</Button>
            <div className="launcher-form-actions">
              <Button variant="ghost" onClick={() => setCategoryMenu(null)}>取消</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
