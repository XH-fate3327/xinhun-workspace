import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
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
  const catDraggedRef = useRef(false);
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

  const addItemFromPath = async (name: string, target: string, isDirectory = false) => {
    let icon = "";
    if (!isDirectory) { try { icon = (await api.getIcon(target)).icon; } catch { icon = ""; } }
    const created = await run(() => api.create("launcherItems", { name, path: target, icon, kind: isDirectory ? "folder" : kindOf(target), category: activeCategory === "all" ? "" : activeCategory }));
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
      else setError(kindOf(target) === "folder" ? "文件夹没有独立图标，会使用默认文件夹图标" : "没有取到图标（该文件可能没有关联图标）");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fillFromPath = (target: string) => {
    const base = target.split(/[\\/]/).filter(Boolean).pop() ?? target;
    const name = base.replace(/\.(exe|lnk|url|bat|cmd)$/i, "");
    setDraft((current) => (current ? { ...current, path: target, name: current.name.trim() ? current.name : name } : current));
  };

  const pickFolderPath = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const result = await api.pickFolder();
      if (result.path) fillFromPath(result.path);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickFilePath = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const result = await api.pickFile();
      if (result.path) fillFromPath(result.path);
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

  const onDropFiles = async (event: DragEvent<HTMLDivElement>) => {    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    const entries = Array.from(event.dataTransfer.items || [])
      .map((item) => {
        try {
          return item.webkitGetAsEntry?.() ?? null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FileSystemEntry => Boolean(entry));
    const folderNames = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
    setBusy(true); setError("");
    try {
      // 拖入文件夹：浏览器只给名字，服务端按名字在桌面/文档/下载里反查路径
      if (folderNames.length > 0) {
        for (const name of folderNames) {
          const result = await api.findPath(name);
          if (result.path) await addItemFromPath(name, result.path, true);
          else setError(`没在桌面 / 文档 / 下载里找到「${name}」，请点「选文件夹」手动选一次`);
        }
        return;
      }
      if (files.length > 0) {
        for (const file of files) {
          if (/\.(lnk|url)$/i.test(file.name)) {
            const base64 = await fileToBase64(file);
            const result = await api.resolveShortcut(file.name, base64);
            if (result.path) {
              await addItemFromPath(file.name.replace(/\.(lnk|url)$/i, ""), result.path, Boolean(result.isDirectory));
            } else {
              setError("无法解析这个快捷方式的目标路径");
            }
          } else {
            const found = await api.findPath(file.name);
            if (found.path) await addItemFromPath(file.name, found.path);
            else setError(`没在桌面 / 文档 / 下载里找到「${file.name}」，请点「选文件」手动选一次`);
          }
        }
        return;
      }
      const candidates = [event.dataTransfer.getData("text/plain"), event.dataTransfer.getData("text/uri-list")].map((value) => value.trim()).filter(Boolean);
      for (const candidate of candidates) {
        let target = candidate;
        if (candidate.startsWith("file://")) {
          try {
            target = decodeURIComponent(new URL(candidate).pathname);
          } catch {
            continue;
          }
        }
        target = target.replace(/^\/([a-zA-Z]:[\\/])/, "$1").trim();
        if (/^[a-zA-Z]:[\\/]|^\\\\|^\//.test(target)) {
          const name = target.split(/[\\/]/).filter(Boolean).pop() ?? target;
          await addItemFromPath(name, target);
          return;
        }
      }
      setError("没有读到可用的路径：请拖 .lnk 快捷方式、拖桌面上的文件夹，或点「选文件夹」。");
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

  const dropHandlerRef = useRef(onDropFiles);
  dropHandlerRef.current = onDropFiles;
  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => { event.preventDefault(); };
    const handle = (event: globalThis.DragEvent) => {
      event.preventDefault();
      void dropHandlerRef.current(event as unknown as DragEvent<HTMLDivElement>);
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", handle);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", handle);
    };
  }, []);

  return (
    <div className="launcher-page">
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
        <div
          className={classNames("launcher-category", activeCategory === "all" && "active")}
          role="button"
          tabIndex={0}
          onClick={() => setActiveCategory("all")}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveCategory("all"); }}
        >
          <strong>全部</strong><small className="launcher-category-count">{items.length}</small>
        </div>
        {categories.map((category, index) => (
          <div
            key={category.id}
            className={classNames("launcher-category", "is-draggable", activeCategory === category.id && "active", catDragIndex === index && "is-dragging", catOverIndex === index && catDragIndex !== null && catDragIndex !== index && "is-over")}
            draggable
            role="button"
            tabIndex={0}
            onDragStart={() => { catDraggedRef.current = true; setCatDragIndex(index); }}
            onDragOver={(event) => { event.preventDefault(); setCatOverIndex(index); }}
            onDrop={(event) => void onCategoryReorder(index)(event)}
            onDragEnd={() => { setCatDragIndex(null); setCatOverIndex(null); window.setTimeout(() => { catDraggedRef.current = false; }, 50); }}
            onClick={() => { if (catDraggedRef.current) { catDraggedRef.current = false; return; } setActiveCategory(category.id); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveCategory(category.id); }}
            onContextMenu={(event) => { event.preventDefault(); setCategoryMenu({ id: category.id, name: category.name }); }}
            title={`${category.name}（点击切换，右键修改/删除，拖动调整顺序）`}
          >
            <strong>{category.name}</strong><small className="launcher-category-count">{items.filter((item) => String(item.category ?? "") === category.id).length}</small>
          </div>
        ))}
        <button className="launcher-category launcher-category-add" onClick={() => setCategoryDraft({ name: "" })}><Plus size={15} />新建分类夹</button>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="这里还没有快捷方式" description="点右上角「添加快捷方式」，或把桌面的 .lnk 快捷方式直接拖进来。" />
      ) : (
        <div className="launcher-grid" key={activeCategory}>
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
                <button className="launcher-open" onDoubleClick={() => void openItem(item)} title={`${String(item.name ?? "")}（双击打开）\n${String(item.path ?? "")}`}>
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
            <label className="launcher-field"><span>路径</span>
              <div className="launcher-path-row">
                <input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} placeholder="C:\Windows\notepad.exe 或 D:\工作\项目" />
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void pickFolderPath()}>选文件夹</Button>
                <Button variant="secondary" size="sm" loading={busy} onClick={() => void pickFilePath()}>选文件</Button>
              </div>
            </label>
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
