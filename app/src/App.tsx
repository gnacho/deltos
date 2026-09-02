import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import AuthGate from '@/auth/AuthGate';
import { DataProvider } from '@/data/DataProvider';
import Layout from '@/components/Layout';

import ErrorBoundary from '@/components/ErrorBoundary';
import { lazyRetry } from '@/lib/lazy-retry';

/* React.lazy por ruta desde el día 1, con reintento anti pantalla-negra */
const BoardPage = lazyRetry(() => import('@/pages/BoardPage'));
const ExpenseBoard = lazyRetry(() => import('@/pages/ExpenseBoard'));
const ProjectsPage = lazyRetry(() => import('@/pages/ProjectsPage'));
const ActivityPage = lazyRetry(() => import('@/pages/ActivityPage'));
const SummaryPage = lazyRetry(() => import('@/pages/SummaryPage'));
const RoutinesPage = lazyRetry(() => import('@/pages/RoutinesPage'));
const SettingsPage = lazyRetry(() => import('@/pages/SettingsPage'));
const InvitePage = lazyRetry(() => import('@/pages/InvitePage'));

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7" role="status">
      <p className="text-sm text-muted animate-pulse">{t('common.loading')}</p>
    </div>
  );
}

function ProtectedRoutes() {
  return (
    <AuthGate>
      <DataProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route
              index
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <BoardPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="p/:projectId"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <BoardPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="projects"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <ProjectsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="activity"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <ActivityPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="summary"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <SummaryPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="routines"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <RoutinesPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="settings"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <SettingsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="expenses"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <ExpenseBoard />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DataProvider>
    </AuthGate>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="invite/:token"
            element={
              <Suspense fallback={<RouteFallback />}>
                <InvitePage />
              </Suspense>
            }
          />
          <Route path="*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
