import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  MagnifyingGlass, Plus, FloppyDisk, CheckCircle, WarningCircle, SidebarSimple,
  ArrowRight, Command, Power, House, DownloadSimple, ImageSquare, MusicNotes, Gear,
} from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { formatDateTime, classNames } from "../utils";
import { normalizeAppearance } from "../appearance";
import { Button, IconButton, Modal, Skeleton, ErrorState, Badge, ConfirmDialog } from "./ui";
import { AmbientEnvironment, chooseAmbientScene } from "./AmbientEnvironment";
import { ModuleArtwork, type ModuleArtworkName } from "./ModuleArtwork";
import type { Entity } from "../types";

const baseGroups = [
  { label: "日常", links: [
    { to: "/", label: "任务计划", module: "plan", tone: "cyan" },
  ] },
  { label: "工作", links: [
    { to: "/media", label: "自媒体", module: "media", tone: "coral" },
    { to: "/desk", label: "处理台", module: "desk", tone: "cyan" },
    { to: "/launcher", label: "启动台", module: "launcher", tone: "teal" },
  ] },
  { label: "系统", links: [{ to: "/settings", label: "数据与设置", module: "settings", tone: "graphite" }] },
] satisfies Array<{ label: string; links: Array<{ to: string; label: string; module: ModuleArtworkName; tone: string }> }>;

const collectionRoutes: Record<string, string> = {
  mediaContents: "/media", launcherItems: "/launcher", quickMemos: "/", deskProjects: "/desk", planSlots: "/",
};

const routeMeta: Record<string, { label: string; module: ModuleArtworkName; tone: string; index: string }> = {
  "/": { label: "任务计划", module: "plan", tone: "cyan", index: "00" },
  "/media": { label: "自媒体", module: "media", tone: "coral", index: "01" },
  "/desk": { label: "处理台", module: "desk", tone: "cyan", index: "02" },
  "/launcher": { label: "启动台", module: "launcher", tone: "teal", index: "03" },
  "/settings": { label: "数据与设置", module: "settings", tone: "graphite", index: "04" },
};

export function AppLayout() {
  const { data, run, saveNow, saveStatus } = useWorkspace();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [exitState, setExitState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const system = useQuery({ queryKey: ["system"], queryFn: api.systemStatus, staleTime: 30_000 });
  const currentPage = routeMeta[location.pathname] ?? routeMeta["/"];
  const appearance = normalizeAppearance(data.settings.appearance);
  const theme = data.settings.theme === "dark" ? "dark" : "light";
  const ambientScene = chooseAmbientScene(currentPage.module, theme);
  const customBackground = typeof data.settings.background_image === "string" && data.settings.background_image.startsWith("data:image") ? data.settings.background_image : "";
  // 背景透明：整窗半透明 + 页面背景透明，让桌面动态壁纸透出来（优先级高于自定义背景图）
  const transparentBackground = data.settings.transparentBackground === true;
  const transparentAlpha = typeof data.settings.transparentAlpha === "number" ? Math.min(255, Math.max(170, data.settings.transparentAlpha)) : 215;
  const backgroundUrl = transparentBackground ? "" : customBackground;
  // 顶栏快捷方式：下载/图片/音乐 的显示名与目标路径来自设置
  const topbarShortcuts = (data.settings.topbarShortcuts as Record<string, { label?: string; path?: string }> | undefined) ?? {};
  const shortcut = (key: string) => {
    const saved = topbarShortcuts[key] ?? {};
    const fallback: Record<string, { label: string; path: string }> = {
      download: { label: "下载", path: "D:\\下载" },
      photo: { label: "图片", path: "D:\\下载\\图片" },
      music: { label: "音乐", path: "D:\\下载\\音乐" },
    };
    return { label: saved.label || fallback[key].label, path: saved.path || fallback[key].path };
  };

  useEffect(() => {
    const scale = typeof data.settings.uiScale === "number" ? Math.min(1.2, Math.max(0.8, data.settings.uiScale)) : 1;
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  }, [data.settings.uiScale]);

  useEffect(() => {
    document.body.classList.toggle("transparent-background", transparentBackground);
    const timer = window.setTimeout(() => {
      void api.setWindowOpacity(transparentBackground ? transparentAlpha : 255).catch(() => undefined);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("transparent-background");
    };
  }, [transparentBackground, transparentAlpha]);

  // 侧边栏顺序：可拖动排序，结果存 settings.navOrder（分组名 → 路由数组）
  const navOrder = (data.settings.navOrder as Record<string, string[]> | undefined) ?? {};
  // 自定义导航名称：右键重命名，存 settings.navLabels（路由 → 名称）
  const navLabels = (data.settings.navLabels as Record<string, string> | undefined) ?? {};
  const [renameTarget, setRenameTarget] = useState<{ to: string; label: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openRename = (to: string, label: string) => {
    setRenameTarget({ to, label });
    setRenameValue(label);
  };
  const saveRename = async () => {
    if (!renameTarget) return;
    const value = renameValue.trim();
    const next: Record<string, string> = { ...navLabels };
    if (value && value !== renameTarget.label) next[renameTarget.to] = value;
    else delete next[renameTarget.to];
    await run(() => api.saveSettings({ navLabels: next }));
    setRenameTarget(null);
  };
  const groups = baseGroups.map((group) => {
    const order = navOrder[group.label];
    if (!order || order.length === 0) return group;
    const sorted = [...group.links].sort((a, b) => {
      const ia = order.indexOf(a.to);
      const ib = order.indexOf(b.to);
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
    });
    return { ...group, links: sorted };
  });
  const [dragInfo, setDragInfo] = useState<{ group: string; from: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ group: string; index: number } | null>(null);

  const reorderGroup = async (groupLabel: string, from: number, to: number) => {
    if (from === to) return;
    const group = groups.find((g) => g.label === groupLabel);
    if (!group) return;
    const links = [...group.links];
    const [moved] = links.splice(from, 1);
    links.splice(to, 0, moved);
    await run(() => api.saveSettings({ navOrder: { ...navOrder, [groupLabel]: links.map((link) => link.to) } }));
  };
  const onNavDragStart = (group: string, from: number) => (event: React.DragEvent) => {
    setDragInfo({ group, from });
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", String(from)); } catch { /* ignore */ }
  };
  const onNavDragOver = (group: string, index: number) => (event: React.DragEvent) => {
    if (!dragInfo || dragInfo.group !== group) return;
    event.preventDefault();
    setDropAt({ group, index });
  };
  const onNavDrop = (group: string, index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    if (dragInfo && dragInfo.group === group) void reorderGroup(group, dragInfo.from, index);
    setDragInfo(null);
    setDropAt(null);
  };
  const onNavDragEnd = () => { setDragInfo(null); setDropAt(null); };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = appearance;
  }, [appearance, theme]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // 环境层视差：滚动时让背景以极低速率位移，玻璃背后才有东西可折射。
  // 只写一个 CSS 变量并由合成层处理，不触发 React 重渲染。
  useEffect(() => {
    const root = document.documentElement;
    if (appearance !== "liquid") {
      root.style.removeProperty("--ambient-shift");
      return;
    }
    // 视差是纯增强。任何一个依赖的浏览器 API 缺席都必须静默降级，
    // 绝不能让整个应用外壳挂掉。
    if (typeof window.requestAnimationFrame !== "function") return;
    const motion = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      // 夹在 ±110px：环境层只向外扩了 14%，位移超过这个量长页面底部会露边。
      root.style.setProperty("--ambient-shift", String(Math.max(-110, Math.min(0, Math.round(window.scrollY * -0.04)))));
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    const sync = () => {
      window.removeEventListener("scroll", onScroll);
      if (motion?.matches) { root.style.setProperty("--ambient-shift", "0"); return; }
      window.addEventListener("scroll", onScroll, { passive: true });
      apply();
    };
    sync();
    motion?.addEventListener("change", sync);
    return () => {
      motion?.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty("--ambient-shift");
    };
  }, [appearance]);

  const saveAndExit = async () => {
    if (exitState === "saving" || exitState === "done") return;
    setExitState("saving");
    try {
      await saveNow();
      await api.saveAndExit();
      setExitState("done");
      document.title = "心魂工作台已安全退出";
    } catch {
      setExitState("error");
    }
  };

  return (
    <div
      className={classNames("app-shell", appearance === "neo" && "neo-shell", collapsed && "sidebar-collapsed")}
      data-appearance={appearance}
      data-accent={String(data.settings.accentColor ?? "cyan")}
      data-module={currentPage.module}
      data-ambient={ambientScene}
    >
      {backgroundUrl ? <CustomBackground url={backgroundUrl} /> : transparentBackground ? null : appearance === "liquid" ? <AmbientEnvironment scene={ambientScene} /> : appearance === "notebook" ? <NotebookEnvironment /> : null}
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar glass-regular">
        <div className="brand"><div className="brand-mark" aria-hidden="true"><img src="/assets/brand/app-icon.png" alt="" draggable={false} /></div><div className="brand-copy"><strong>心魂工作台</strong><span>本地个人空间</span></div>{appearance === "neo" ? <span className="brand-edition">NEO / PERSONAL CONTROL DESK</span> : null}</div>
        <nav aria-label="主导航">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.links.map(({ to, label, module, tone }, index) => {
                const displayLabel = navLabels[to] ?? label;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    data-tone={tone}
                    draggable
                    onDragStart={onNavDragStart(group.label, index)}
                    onDragOver={onNavDragOver(group.label, index)}
                    onDrop={onNavDrop(group.label, index)}
                    onDragEnd={onNavDragEnd}
                    onContextMenu={(event) => { event.preventDefault(); openRename(to, displayLabel); }}
                    className={({ isActive }) => classNames("nav-link", isActive && "active", dragInfo?.group === group.label && dragInfo.from === index && "nav-dragging", dropAt?.group === group.label && dropAt.index === index && "nav-drop-target")}
                    title={`${displayLabel}（右键重命名 / 拖动排序）`}
                  >
                    {appearance === "neo" ? <NeoModuleEmblem module={module} /> : <ModuleArtwork module={module} />}<span>{displayLabel}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={classNames("local-state", system.data?.backupStatus?.state === "error" && "backup-error")}><span className="status-dot" /><div><strong>{system.data?.backupStatus?.state === "error" ? "自动备份失败" : "仅保存在这台电脑"}</strong><small>{system.data?.backupStatus?.state === "error" ? system.data.backupStatus.lastError : system.data?.latestBackup ? `备份于 ${formatDateTime(system.data.latestBackup.createdAt)}` : "等待首次备份"}</small></div></div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar glass-clear">
          <div className="topbar-left">
            <IconButton label={collapsed ? "展开导航" : "收起导航"} onClick={() => setCollapsed((value) => !value)}><SidebarSimple size={20} /></IconButton>
            <span className="toolbar-page-icon" data-tone={currentPage.tone} aria-hidden="true"><ModuleArtwork module={currentPage.module} /></span>
            <div className="toolbar-context"><strong>{navLabels[location.pathname] ?? currentPage.label}</strong><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span></div>
            {appearance === "neo" ? <span className="topbar-index">{currentPage.index} / 04</span> : null}
          </div>
          <div className="topbar-actions">
            <span className="topbar-quick">
              <IconButton label="打开资源管理器" onClick={() => void api.openExplorer().catch(() => undefined)}><House size={19} /></IconButton>
              <IconButton label={`${shortcut("download").label}（${shortcut("download").path}）`} onClick={() => void api.openPath(shortcut("download").path).catch(() => undefined)}><DownloadSimple size={19} /></IconButton>
              <IconButton label={`${shortcut("photo").label}（${shortcut("photo").path}）`} onClick={() => void api.openPath(shortcut("photo").path).catch(() => undefined)}><ImageSquare size={19} /></IconButton>
              <IconButton label={`${shortcut("music").label}（${shortcut("music").path}）`} onClick={() => void api.openPath(shortcut("music").path).catch(() => undefined)}><MusicNotes size={19} /></IconButton>
              <IconButton label="控制面板" onClick={() => void api.openControlPanel().catch(() => undefined)}><Gear size={19} /></IconButton>
              <IconButton label="关机" onClick={() => setShutdownOpen(true)}><Power size={19} /></IconButton>
            </span>
            <button className="search-trigger glass-clear" aria-label="搜索所有内容" title="搜索所有内容" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /><span>搜索所有内容</span><kbd><Command size={12} />K</kbd></button>
            <Button className="manual-save" variant="secondary" size="sm" loading={saveStatus === "saving"} onClick={() => void saveNow().catch(() => undefined)}><FloppyDisk size={16} />手动保存</Button>
            <Button className="save-exit" variant="ghost" size="sm" loading={exitState === "saving"} disabled={exitState === "done"} onClick={() => void saveAndExit()}><Power size={16} />{exitState === "error" ? "退出失败，重试" : "保存并退出"}</Button>
            <SaveIndicator status={saveStatus} />
          </div>
        </header>
        <main className="page-container" id="main-content" tabIndex={-1}><Outlet /></main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ConfirmDialog
        open={shutdownOpen}
        title="关机？"
        description="执行后电脑会在 10 秒后关机（可用 shutdown /a 取消）。请先确认已保存工作。"
        confirmLabel="确认关机"
        danger
        onClose={() => setShutdownOpen(false)}
        onConfirm={async () => { await api.shutdown().catch(() => undefined); setShutdownOpen(false); }}
      />
      <Modal open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title="重命名导航">
        <div className="rename-panel">
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); if (event.key === "Escape") setRenameTarget(null); }}
            placeholder="输入新的名称"
            aria-label="导航名称"
          />
          <div className="rename-actions">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button onClick={() => void saveRename()}>保存</Button>
          </div>
        </div>
      </Modal>
      {exitState === "done" ? <ExitScreen /> : null}
    </div>
  );
}

function NeoModuleEmblem({ module }: { module: ModuleArtworkName }) {
  return <span className="neo-nav-emblem" data-module={module} aria-hidden="true" />;
}

function NotebookEnvironment() {
  return <div className="notebook-environment" aria-hidden="true" />;
}

function CustomBackground({ url }: { url: string }) {
  return <div className="custom-background" aria-hidden="true" style={{ backgroundImage: `url("${url}")` }} />;
}

function ExitScreen() {
  return <div className="exit-screen" role="status"><div className="exit-card"><CheckCircle size={32} weight="fill" /><strong>数据已保存，心魂工作台已安全退出</strong><p>现在可以关闭这个页面。下次双击启动图标，会重新启动并打开工作台。</p></div></div>;
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  const values = {
    idle: { icon: FloppyDisk, label: "自动保存" },
    saving: { icon: FloppyDisk, label: "保存中" },
    saved: { icon: CheckCircle, label: "已保存" },
    error: { icon: WarningCircle, label: "保存失败" },
  } as const;
  const value = values[status];
  const Icon = value.icon;
  return <div className={`save-indicator save-${status}`} role="status"><Icon size={16} /><span>{value.label}</span></div>;
}

function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const search = useQuery({ queryKey: ["search", query], queryFn: () => api.search(query), enabled: open && query.trim().length > 0 });
  const grouped = useMemo(() => {
    return (search.data ?? []).reduce<Record<string, Entity[]>>((result, item) => {
      (result[item.module] ??= []).push(item);
      return result;
    }, {});
  }, [search.data]);
  const moduleNames: Record<string, string> = { dashboard: "首页", today: "今日计划", media: "自媒体", desk: "处理台", plan: "任务计划", consulting: "咨询工作", fitness: "健身计划", diet: "饮食计划", entertainment: "游戏娱乐" };
  return (
    <Modal open={open} title="搜索工作台" description="按模块查找标题、笔记和记录内容" onClose={onClose} wide>
      <div className="command-search glass-clear"><MagnifyingGlass size={20} /><input autoFocus aria-label="搜索关键词" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /></div>
      <div className="search-results">
        {!query ? <div className="search-hint">输入内容开始搜索，按 Esc 关闭。</div> : search.isLoading ? <Skeleton lines={4} /> : search.error ? <ErrorState message={(search.error as Error).message} /> : search.data?.length === 0 ? <div className="search-hint">没有找到匹配内容。</div> : Object.entries(grouped).map(([module, items]) => (
          <section className="search-group" key={module}><h3>{moduleNames[module] ?? module}</h3>{items.map((item) => (
            <button key={`${item.collection}-${item.id}`} onClick={() => { navigate(collectionRoutes[item.collection] ?? "/"); onClose(); }}><span>{item.title || "未命名记录"}</span><ArrowRight size={16} /></button>
          ))}</section>
        ))}
      </div>
    </Modal>
  );
}
