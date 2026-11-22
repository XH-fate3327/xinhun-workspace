import fs from "node:fs";
import path from "node:path";

// 默认独立窗口尺寸（2026-11-22 从当前运行窗口实测：1317x853，外框尺寸）
const DEFAULT_WINDOW_SIZE = "1317,853";

export function defaultDataRootFor(platform, environment, homeDirectory) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    return platformPath.join(environment.LOCALAPPDATA ?? environment.APPDATA ?? homeDirectory, "XinhunWorkspace");
  }
  if (platform === "darwin") {
    return platformPath.join(homeDirectory, "Library", "Application Support", "XinhunWorkspace");
  }
  return platformPath.join(environment.XDG_DATA_HOME ?? platformPath.join(homeDirectory, ".local", "share"), "XinhunWorkspace");
}

export function npmCommandFor(platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function browserOpenCommandFor(platform, url, profileDir) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    // 独立窗口（无地址栏、无标签），优先 Edge/Chrome 的 --app 模式，再退回默认浏览器。
    const candidates = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const exe of candidates) {
      if (fs.existsSync(exe)) {
        const args = [`--app=${url}`, `--window-size=${DEFAULT_WINDOW_SIZE}`];
        // 独立 user-data-dir：保证是全新 Edge 实例；否则复用已有进程时会忽略 --window-size
        if (profileDir) args.push(`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check");
        return { command: exe, args };
      }
    }
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}
