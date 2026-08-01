import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/i18n';
import '@/index.css';
import { applyBootPreferences } from '@/theme/ThemeProvider';
import App from '@/App';

// Preferencias (densidad/reduce-motion) antes del primer render.
applyBootPreferences();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
