import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { ClipboardText, ImageSquare, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { classNames } from "../utils";
import { Button, ErrorState, IconButton, Modal, PageHeader } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";

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

function defaultImageName() {
  return `图片 ${new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

export function DeskPage() {
  const { data, run, registerSaveHandler } = useWorkspace();
  const images = useMemo(
    () => [...data.deskImages].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))),
    [data.deskImages],
  );
  const notes = useMemo(
    () => [...data.deskNotes].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))),
    [data.deskNotes],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [savedName, setSavedName] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [viewImage, setViewImage] = useState<{ id: string; url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const note = data.deskNotes.find((item) => item.id === selectedId) ?? null;
    const nextName = note?.name ?? "";
    const nextContent = note?.content ?? "";
    setName(nextName);
    setContent(nextContent);
    setSavedName(nextName);
    setSavedContent(nextContent);
  }, [selectedId, data.deskNotes]);

  const persistNote = useCallback(async () => {
    if (!selectedId) return;
    if (name === savedName && content === savedContent) return;
    await run(() => api.update("deskNotes", selectedId, { name: name.trim() || "未命名便签", content }));
    setSavedName(name);
    setSavedContent(content);
  }, [selectedId, name, content, savedName, savedContent, run]);

  useEffect(() => {
    if (name === savedName && content === savedContent) return;
    const timer = window.setTimeout(() => void persistNote().catch(() => undefined), 600);
    return () => window.clearTimeout(timer);
  }, [name, content, savedName, savedContent, persistNote]);

  useEffect(() => registerSaveHandler(persistNote), [persistNote, registerSaveHandler]);

  const addImage = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const dataUrl = await compressImage(file);
      await run(() => api.create("deskImages", { data_url: dataUrl, mime_type: "image/jpeg", name: defaultImageName() }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [run]);

  const createNote = useCallback(async () => {
    const created = await run(() => api.create("deskNotes", { name: "新便签", content: "" }));
    setSelectedId(created.id);
  }, [run]);

  const deleteNote = useCallback(async (id: string) => {
    await run(() => api.remove("deskNotes", id));
    if (selectedId === id) setSelectedId(null);
  }, [run, selectedId]);

  const deleteImage = useCallback(async (id: string) => {
    await run(() => api.remove("deskImages", id));
  }, [run]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) void addImage(file);
      }
    }
  }, [addImage]);

  const onFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    for (const file of Array.from(files)) void addImage(file);
    event.target.value = "";
  }, [addImage]);

  return (
    <div className="desk-page" onPaste={onPaste}>
      <PageHeader
        icon={<ModuleArtwork module="desk" />}
        eyebrow="工作台"
        title="处理台"
        description="粘贴截图或上传图片到看板，右侧便签记录知识点与备忘。"
        actions={<Button onClick={() => fileInput.current?.click()} loading={busy}><UploadSimple size={17} />上传图片</Button>}
      />
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <div className="desk-layout">
        <section className="desk-board">
          <div className="desk-board-toolbar">
            <span>图片看板 <kbd>Ctrl+V</kbd> 直接粘贴</span>
            <span className="quiet-line">{images.length} 张图片</span>
          </div>
          {error ? <ErrorState message={error} /> : null}
          {images.length === 0 ? (
            <button className="desk-dropzone" onClick={() => fileInput.current?.click()}>
              <ImageSquare size={40} />
              <strong>把截图粘贴到这里，或点击上传图片</strong>
              <small>支持 PNG / JPG / WebP，会自动压缩到合适尺寸</small>
            </button>
          ) : (
            <div className="desk-image-grid">
              {images.map((image) => (
                <div className="desk-image-card" key={image.id}>
                  <button className="desk-image-thumb" onClick={() => setViewImage({ id: image.id, url: image.data_url, name: image.name })}>
                    <img src={image.data_url} alt={image.name || "图片"} loading="lazy" draggable={false} />
                  </button>
                  <div className="desk-image-meta">
                    <span title={image.name}>{image.name || "未命名"}</span>
                    <IconButton label="删除图片" onClick={() => void deleteImage(image.id)}><Trash size={15} /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="desk-notes">
          <div className="desk-notes-head">
            <span>便签目录</span>
            <Button variant="ghost" size="sm" onClick={() => void createNote()}><Plus size={15} />新建</Button>
          </div>
          <div className="desk-notes-list">
            {notes.length === 0 ? <p className="quiet-line">还没有便签，点「新建」开始记录。</p> : notes.map((note) => (
              <button key={note.id} className={classNames("desk-note-item", note.id === selectedId && "active")} onClick={() => setSelectedId(note.id)}>
                <ClipboardText size={16} /><span>{note.name || "未命名便签"}</span>
              </button>
            ))}
          </div>
          {selectedId ? (
            <div className="desk-note-editor">
              <input className="desk-note-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="便签名称" aria-label="便签名称" />
              <textarea className="desk-note-content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录知识点或备忘……" aria-label="便签内容" />
              <Button variant="ghost" size="sm" onClick={() => void deleteNote(selectedId)}><Trash size={15} />删除便签</Button>
            </div>
          ) : null}
        </aside>
      </div>
      {viewImage ? (
        <Modal open onClose={() => setViewImage(null)} title={viewImage.name || "图片"} wide>
          <img className="desk-image-full" src={viewImage.url} alt={viewImage.name || "图片"} />
        </Modal>
      ) : null}
    </div>
  );
}
