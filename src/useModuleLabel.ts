import { useLocation } from "react-router-dom";
import { useWorkspace } from "./WorkspaceContext";

/** 返回当前路由在 settings.navLabels 里的自定义名称；没有则用 fallback（页面默认标题）。 */
export function useModuleLabel(fallback: string): string {
  const { data } = useWorkspace();
  const { pathname } = useLocation();
  const labels = (data.settings.navLabels as Record<string, string> | undefined) ?? {};
  return labels[pathname] ?? fallback;
}
