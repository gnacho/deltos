import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/i18n';
import '@/index.css';
import { applyBootPreferences } from '@/theme/ThemeProvider';
import App from '@/App';

// Preferencias (densidad/reduce-motion) antes del primer render.
applyBootPreferences();

// PWA offline: el SW solo cachea estáticos (la API es network-only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
