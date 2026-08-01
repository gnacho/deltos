import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import AuthGate from '@/auth/AuthGate';
import { DataProvider } from '@/data/DataProvider';
import Layout from '@/components/Layout';

/* React.lazy por ruta desde el día 1 */
const BoardPage = lazy(() => import('@/pages/BoardPage'));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'));
const ActivityPage = lazy(() => import('@/pages/ActivityPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7" role="status">
      <p className="text-sm text-muted animate-pulse">{t('common.loading')}</p>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthGate>
        <DataProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <BoardPage />
                    </Suspense>
                  }
                />
                <Route
                  path="p/:projectId"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <BoardPage />
                    </Suspense>
                  }
                />
                <Route
                  path="projects"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <ProjectsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="activity"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <ActivityPage />
                    </Suspense>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <SettingsPage />
                    </Suspense>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </DataProvider>
      </AuthGate>
    </ThemeProvider>
  );
}
