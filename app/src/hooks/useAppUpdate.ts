/**
 * Comprobar actualizaciones (webapp-shell).
 * Fuente = última RELEASE del repo GitHub (fallback a tags si 404). GET anónima
 * a api.github.com SOLO al pulsar el botón: no sale ningún dato de la instalación.
 * Si el admin ya desplegó un build nuevo (SW en waiting), se ofrece
 * "Actualizar y recargar" sin pasar por GitHub.
 * Incluye dismiss de versión (#119): el ribbon se puede descartar por versión
 * y vuelve a salir solo si aparece una más nueva.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiPost } from '../data/api-client';

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';

const DISMISS_KEY = 'deltos-release-dismissed';

/** a vs b semver ('1.10.0' > '1.9.0'); prefijo 'v' ignorado. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function getDismissed(): string {
  try { return window.localStorage.getItem(DISMISS_KEY) ?? ''; } catch { return ''; }
}

export function useAppUpdate(currentVersion: string, repoUrl?: string) {
  const swSupported = 'serviceWorker' in navigator;
  const [state, setState] = useState<UpdateState>('idle');
  const [latest, setLatest] = useState<{ version: string; url: string } | null>(null);
  const [swWaiting, setSwWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(getDismissed());

  useEffect(() => {
    if (!swSupported) return;
    let reg: ServiceWorkerRegistration | undefined;
    const onFound = () => {
      const sw = reg?.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) setSwWaiting(sw);
      });
    };
    navigator.serviceWorker.getRegistration().then((r) => {
      reg = r;
      if (r?.waiting) setSwWaiting(r.waiting);
      r?.addEventListener('updatefound', onFound);
      r?.update().catch(() => {});
    });
    return () => reg?.removeEventListener('updatefound', onFound);
  }, [swSupported]);

  const repo = repoUrl?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];

  const check = async () => {
    if (!repo) return;
    setState('checking');
    try {
      const headers = { Accept: 'application/vnd.github+json' };
      let version = '';
      let url = `${repoUrl}/releases`;
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string; html_url?: string };
        version = data.tag_name ?? '';
        url = data.html_url ?? url;
      } else if (res.status === 404) {
        const tags = (await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers })
          .then((r) => (r.ok ? r.json() : []))) as { name?: string }[];
        version = tags[0]?.name ?? '';
      } else {
        throw new Error(`github ${res.status}`); // 403 = rate-limit 60/h por IP
      }
      const ver = version.replace(/^v/, '');
      if (!version || compareSemver(version, currentVersion) <= 0) {
        setState('up-to-date');
      } else if (ver === getDismissed()) {
        setState('up-to-date'); // versión descartada: no mostrar ribbon
      } else {
        setLatest({ version: ver, url });
        setState('available');
      }
    } catch {
      setState('error');
    }
  };

  const applySw = () => {
    if (!swWaiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    swWaiting.postMessage({ type: 'SKIP_WAITING' });
  };

  // Aplica la release nueva en el SERVIDOR (deltos-update.sh, solo admin).
  // El servidor se reinicia; la app se recarga con el build nuevo.
  const applyRelease = async () => {
    await apiPost<{ ok: boolean }>('/api/update/apply');
  };

  const dismissVersion = useCallback(() => {
    if (!latest) return;
    try { window.localStorage.setItem(DISMISS_KEY, latest.version); } catch { /* sin storage */ }
    setDismissed(latest.version);
    setState('up-to-date');
  }, [latest]);

  const isDismissed = latest ? dismissed === latest.version : false;

  return { supported: !!repo || swSupported, state, latest, check, swWaiting, applySw, applyRelease, dismissVersion, isDismissed };
}
