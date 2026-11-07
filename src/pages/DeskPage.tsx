import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { ArrowDown, ArrowUp, FolderSimple, ImageSquare, Plus, TextT, Trash, UploadSimple } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, EmptyState, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";

type DeskBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; data_url: string; mime_type: string };

const MAX_IMAGE_EDGE = 1400;

async function compressImage(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取这张图片"));
      element.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持图片处理");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseBlocks(raw: unknown): DeskBlock[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeskBlock[]) : [];
  } catch {
    return [];
  }
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function DeskPage() {
  const { data, run, registerSaveHandler } = useWorkspace();
  const projects = useMemo(
    () => [...data.deskProjects].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))),
    [data.deskProjects],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DeskBlock[]>([]);
  const [savedBlocks, setSavedBlocks] = useState("[]");
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // 初始自动选中第一个项目
  useEffect(() => {
    if (selectedId == null && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  // 切换项目时加载内容
  useEffect(() => {
    const project = data.deskProjects.find((item) => item.id === selectedId) ?? null;
    const parsed = parseBlocks(project?.blocks);
    setBlocks(parsed);
    setSavedBlocks(project?.blocks ?? "[]");
    setName(project?.name ?? "");
    setSavedName(project?.name ?? "");
    // 仅在选择变化时加载，避免自动保存刷新后覆盖正在编辑的内容
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistProject = useCallback(async () => {
    if (!selectedId) return;
    const blocksJson = JSON.stringify(blocks);
    if (blocksJson === savedBlocks && name === savedName) return;
    await run(() => api.update("deskProjects", selectedId, { name: name.trim() || "未命名项目", blocks: blocksJson }));
    setSavedBlocks(blocksJson);
    setSavedName(name);
  }, [selectedId, blocks, name, savedBlocks, savedName, run]);

  useEffect(() => {
    if (JSON.stringify(blocks) === savedBlocks && name === savedName) return;
    const timer = window.setTimeout(() => void persistProject().catch(() => undefined), 600);
    return () => window.clearTimeout(timer);
  }, [blocks, name, savedBlocks, savedName, persistProject]);

  useEffect(() => registerSaveHandler(persistProject), [persistProject, registerSaveHandler]);

  const addImageBlock = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const dataUrl = await compressImage(file);
      setBlocks((current) => [...current, { id: newId(), type: "image", data_url: dataUrl, mime_type: "image/jpeg" }]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const addTextBlock = useCallback(() => {
    setBlocks((current) => [...current, { id: newId(), type: "text", text: "" }]);
  }, []);

  const updateTextBlock = useCallback((id: string, text: string) => {
    setBlocks((current) => current.map((block) => (block.id === id && block.type === "text" ? { ...block, text } : block)));
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks((current) => current.filter((block) => block.id !== id));
  }, []);

  const moveBlock = useCallback((index: number, delta: number) => {
    setBlocks((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const createProject = useCallback(async () => {
    const created = await run(() => api.create("deskProjects", { name: "新项目", blocks: "[]" }));
    setSelectedId(created.id);
  }, [run]);

  const deleteProject = useCallback(async (id: string) => {
    await run(() => api.remove("deskProjects", id));
    if (selectedId === id) setSelectedId(null);
  }, [run, selectedId]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) void addImageBlock(file);
      }
    }
  }, [addImageBlock]);

  const onFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    for (const file of Array.from(files)) void addImageBlock(file);
    event.target.value = "";
  }, [addImageBlock]);

  return (
    <div className="desk-page" onPaste={onPaste}>
      <PageHeader
        icon={<ModuleArtwork module="desk" />}
        eyebrow="工作台"
        title="处理台"
        description="按项目分类，文字与图片穿插记录。"
        actions={<Button onClick={() => fileInput.current?.click()} loading={busy}><UploadSimple size={17} />添加图片</Button>}
      />
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <div className="desk-layout">
        <aside className="desk-projects">
          <div className="desk-projects-head">
            <span>项目目录</span>
            <Button variant="ghost" size="sm" onClick={() => void createProject()}><Plus size={15} />新建</Button>
          </div>
          <div className="desk-projects-list">
            {projects.length === 0 ? <p className="quiet-line">还没有项目，点「新建」开始。</p> : projects.map((project) => (
              <button key={project.id} className={classNames("desk-project-item", project.id === selectedId && "active")} onClick={() => setSelectedId(project.id)}>
                <FolderSimple size={16} /><span>{project.name || "未命名项目"}</span>
              </button>
            ))}
          </div>
          {selectedId ? (
            <div className="desk-project-meta">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" aria-label="项目名称" />
              <Button variant="ghost" size="sm" onClick={() => void deleteProject(selectedId)}><Trash size={15} />删除项目</Button>
            </div>
          ) : null}
        </aside>
        <section className="desk-content">
          {error ? <div className="field-error">{error}</div> : null}
          {!selectedId ? (
            <EmptyState title="选择或新建一个项目" description="每个项目是一份独立的工作内容，可穿插记录文字和图片。" />
          ) : blocks.length === 0 ? (
            <button className="desk-dropzone" onClick={addTextBlock}>
              <TextT size={40} />
              <strong>从第一段文字或第一张图片开始</strong>
              <small>点这里写文字，或按 Ctrl+V 粘贴截图</small>
            </button>
          ) : (
            <div className="desk-blocks">
              {blocks.map((block, index) => (
                <div className={classNames("desk-block", `desk-block-${block.type}`)} key={block.id}>
                  {block.type === "text" ? (
                    <textarea value={block.text} onChange={(event) => updateTextBlock(block.id, event.target.value)} placeholder="输入文字…" aria-label="文字块" />
                  ) : (
                    <button className="desk-block-image" onClick={() => setViewImage(block.data_url)}><img src={block.data_url} alt="图片" loading="lazy" draggable={false} /></button>
                  )}
                  <div className="desk-block-tools">
                    <IconButton label="上移" onClick={() => moveBlock(index, -1)} disabled={index === 0}><ArrowUp size={14} /></IconButton>
                    <IconButton label="下移" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}><ArrowDown size={14} /></IconButton>
                    <IconButton label="删除" onClick={() => deleteBlock(block.id)}><Trash size={14} /></IconButton>
                  </div>
                </div>
              ))}
              <div className="desk-add-bar">
                <button onClick={addTextBlock}><TextT size={16} />写文字</button>
                <button onClick={() => fileInput.current?.click()}><ImageSquare size={16} />加图片</button>
                <span className="quiet-line">Ctrl+V 粘贴截图</span>
              </div>
            </div>
          )}
        </section>
      </div>
      {viewImage ? (
        <Modal open onClose={() => setViewImage(null)} title="查看图片" wide>
          <img className="desk-image-full" src={viewImage} alt="图片" />
        </Modal>
      ) : null}
    </div>
  );
}
