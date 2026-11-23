import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { ErrorState, Skeleton } from "./components/ui";

const PlanPage = lazy(() => import("./pages/PlanPage").then((module) => ({ default: module.PlanPage })));
const MediaPage = lazy(() => import("./pages/MediaPage").then((module) => ({ default: module.MediaPage })));
const LauncherPage = lazy(() => import("./pages/LauncherPage").then((module) => ({ default: module.LauncherPage })));
const DeskPage = lazy(() => import("./pages/DeskPage").then((module) => ({ default: module.DeskPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Skeleton lines={8} />}>{children}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <div className="route-error"><ErrorState message="页面无法打开，请返回首页后重试。" /></div>,
    children: [
      { index: true, element: <LazyPage><PlanPage /></LazyPage> },
      { path: "media", element: <LazyPage><MediaPage /></LazyPage> },
      { path: "launcher", element: <LazyPage><LauncherPage /></LazyPage> },
      { path: "desk", element: <LazyPage><DeskPage /></LazyPage> },
      { path: "settings", element: <LazyPage><SettingsPage /></LazyPage> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
