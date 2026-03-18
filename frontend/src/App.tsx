import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { DocumentViewerPage } from "@/pages/DocumentViewerPage";

// Lazy imports para code splitting
import { lazy, Suspense } from "react";

const DashboardPage    = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const DocumentsPage    = lazy(() => import("@/pages/DocumentsPage").then((m) => ({ default: m.DocumentsPage })));
const VideosPage       = lazy(() => import("@/pages/VideosPage").then((m) => ({ default: m.VideosPage })));
const SearchPage       = lazy(() => import("@/pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const AreasPage        = lazy(() => import("@/pages/AreasPage").then((m) => ({ default: m.AreasPage })));
const AdminDashboard   = lazy(() => import("@/pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const AdminUsers       = lazy(() => import("@/pages/admin/AdminUsers").then((m) => ({ default: m.AdminUsers })));
const AdminAreas       = lazy(() => import("@/pages/admin/AdminAreas").then((m) => ({ default: m.AdminAreas })));
const AdminConfig      = lazy(() => import("@/pages/admin/AdminConfig").then((m) => ({ default: m.AdminConfig })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,    // 5 minutos
      gcTime: 1000 * 60 * 10,      // 10 minutos
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Skeleton de página cargando
function PageLoader() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="skeleton h-8 w-48 mb-6" />
      <div className="skeleton h-4 w-full mb-3" />
      <div className="skeleton h-4 w-3/4 mb-3" />
      <div className="skeleton h-64 w-full mt-6" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Pública */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protegidas */}
          <Route element={<AppLayout />}>
            <Route
              path="/"
              element={
                <Suspense fallback={<PageLoader />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="/documentos"
              element={
                <Suspense fallback={<PageLoader />}>
                  <DocumentsPage />
                </Suspense>
              }
            />
            <Route path="/documentos/:id" element={<DocumentViewerPage />} />
            <Route
              path="/videos"
              element={
                <Suspense fallback={<PageLoader />}>
                  <VideosPage />
                </Suspense>
              }
            />
            <Route
              path="/buscar"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SearchPage />
                </Suspense>
              }
            />
            <Route
              path="/areas"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AreasPage />
                </Suspense>
              }
            />

            {/* Admin */}
            <Route
              path="/admin"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AdminDashboard />
                </Suspense>
              }
            />
            <Route
              path="/admin/usuarios"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AdminUsers />
                </Suspense>
              }
            />
            <Route
              path="/admin/areas"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AdminAreas />
                </Suspense>
              }
            />
            <Route
              path="/admin/configuracion"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AdminConfig />
                </Suspense>
              }
            />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
