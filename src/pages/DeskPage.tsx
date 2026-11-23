import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { ArrowDown, ArrowUp, FolderSimple, ImageSquare, Plus, TextT, Trash, UploadSimple } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, EmptyState, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";

// 一个块 = 左侧图片区（最多 4 张）+ 右侧文字
type DeskBlock = { id: string; images: string[]; text: string };

const MAX_IMAGE_EDGE = 1000;
const MAX_IMAGES = 4;

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
    if (!Array.isArray(parsed)) return [];
    const result: DeskBlock[] = [];
    for (const block of parsed) {
      // 新格式（图片数组 + 文字）
      if (Array.isArray(block?.images) && typeof block?.text === "string") {
        result.push({ id: String(block.id ?? newId()), images: block.images.map(String), text: block.text });
        continue;
      }
      // 旧格式：单图块
      if (block?.type === "image" && typeof block?.data_url === "string") {
        result.push({ id: String(block.id ?? newId()), images: [block.data_url], text: "" });
        continue;
      }
      // 旧格式：纯文字块 —— 若上一张卡片只有图没文字，就把文字并进去（左图右字）
      if (block?.type === "text") {
        const text = String(block.text ?? "");
        const last = result[result.length - 1];
        if (last && last.images.length > 0 && !last.text) {
          last.text = text;
          continue;
        }
        result.push({ id: String(block.id ?? newId()), images: [], text });
        continue;
      }
      result.push({ id: String(block?.id ?? newId()), images: [], text: "" });
    }
    return result;
  } catch {
    return [];
  }
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function appendImage(current: DeskBlock[], dataUrl: string): DeskBlock[] {
  const last = current[current.length - 1];
  if (last && last.images.length < MAX_IMAGES) {
    return current.map((block, i) => (i === current.length - 1 ? { ...block, images: [...block.images, dataUrl] } : block));
  }
  return [...current, { id: newId(), images: [dataUrl], text: "" }];
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

  useEffect(() => {
    if (selectedId == null && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  useEffect(() => {
    const project = data.deskProjects.find((item) => item.id === selectedId) ?? null;
    const parsed = parseBlocks(project?.blocks);
    setBlocks(parsed);
    setSavedBlocks(project?.blocks ?? "[]");
    setName(project?.name ?? "");
    setSavedName(project?.name ?? "");
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
      setBlocks((current) => appendImage(current, dataUrl));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const addTextBlock = useCallback(() => {
    setBlocks((current) => {
      const last = current[current.length - 1];
      if (last && last.images.length === 0 && !last.text.trim()) return current;
      return [...current, { id: newId(), images: [], text: "" }];
    });
  }, []);

  const updateText = useCallback((id: string, text: string) => {
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, text } : block)));
  }, []);

  const removeImage = useCallback((blockId: string, imageIndex: number) => {
    setBlocks((current) => current
      .map((block) => (block.id === blockId ? { ...block, images: block.images.filter((_, i) => i !== imageIndex) } : block))
      .filter((block) => block.images.length > 0 || block.text.trim() !== ""));
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
        description="按项目分类，图片在左、文字在右，一个板块最多放 4 张图。"
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
            <EmptyState title="选择或新建一个项目" description="每个项目是一份独立的工作内容，图片放左边、文字写右边。" />
          ) : blocks.length === 0 ? (
            <button className="desk-dropzone" onClick={addTextBlock}>
              <TextT size={40} />
              <strong>从第一段文字或第一张图片开始</strong>
              <small>点这里写文字，或按 Ctrl+V 粘贴截图</small>
            </button>
          ) : (
            <div className="desk-blocks">
              {blocks.map((block, index) => (
                <div className="desk-card" key={block.id}>
                  <div className="desk-card-images">
                    {block.images.map((src, imageIndex) => (
                      <div className="desk-card-image" key={imageIndex}>
                        <img src={src} alt={`图片 ${imageIndex + 1}`} loading="lazy" draggable={false} onClick={() => setViewImage(src)} />
                        <button className="desk-card-image-del" aria-label="移除这张图片" onClick={() => removeImage(block.id, imageIndex)}>×</button>
                      </div>
                    ))}
                    {block.images.length < MAX_IMAGES ? (
                      <button className="desk-card-add" onClick={() => fileInput.current?.click()}><ImageSquare size={17} /><span>加图</span></button>
                    ) : null}
                  </div>
                  <textarea
                    className="desk-card-text"
                    value={block.text}
                    onChange={(event) => updateText(block.id, event.target.value)}
                    placeholder="在图片右侧输入文字…"
                    aria-label="文字"
                  />
                  <div className="desk-card-tools">
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
