import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaControls({ busy = false }: { busy?: boolean }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [storage, setStorage] = useState('');
  const [error, setError] = useState('');
  const [cachedReady, setCachedReady] = useState(false);
  const { offlineReady: [ready], needRefresh: [update], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => setError('Offline setup failed. Reconnect and reload to retry.'),
  });
  useEffect(() => {
    const connected = () => setOnline(navigator.onLine);
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => setInstall(null);
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    window.addEventListener('beforeinstallprompt', prompt);
    window.addEventListener('appinstalled', installed);
    // The install event is transient; check the actual cache on subsequent launches too.
    let alive = true;
    if ('serviceWorker' in navigator && 'caches' in window && !import.meta.env.DEV) {
      navigator.serviceWorker.ready.then(async () => {
        const base = new URL(import.meta.env.BASE_URL, location.origin);
        const paths = ['index.html', 'ocr/worker.min.js', 'ocr/eng.traineddata.gz',
          'ocr/tesseract-core-lstm.wasm.js', 'ocr/tesseract-core-lstm.wasm',
          'ocr/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-simd-lstm.wasm'];
        const entries = await Promise.all(paths.map((path) => caches.match(new URL(path, base).href, { ignoreSearch: true })));
        if (alive) setCachedReady(entries.every(Boolean));
      }).catch(() => { if (alive) setError('Could not confirm offline cache. Reconnect and reload.'); });
    }
    const estimate = () => navigator.storage?.estimate().then(({ usage, quota }) => {
      setStorage(`${Math.round((usage || 0) / 1048576)} MB used${quota ? ` / ${Math.round(quota / 1048576)} MB site quota` : ''}`);
    }).catch(() => {});
    estimate();
    const interval = window.setInterval(estimate, 30000);
    return () => {
      alive = false;
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', installed);
      window.clearInterval(interval);
    };
  }, []);
  return <aside className="pwa-controls bg-blue-50 border-b border-blue-200 px-4 py-2 text-xs text-blue-900 flex flex-wrap items-center justify-between gap-2" aria-label="Application availability">
    <div aria-live="polite">
      <strong>{online ? 'Connected' : 'Offline'}</strong> · {error || (ready || cachedReady ? 'Offline scanner ready' : import.meta.env.DEV ? 'Offline installation available in production build' : 'Preparing offline scanner…')}
      {storage && <span className="block text-[10px] text-slate-500">{storage} · Delete saved audits in History to free space.</span>}
    </div>
    <div className="flex flex-wrap gap-2 items-center">
      {install && <button className="rounded-lg bg-blue-600 text-white px-3 py-2" onClick={async () => {
        try { await install.prompt(); await install.userChoice; setInstall(null); } catch { setError('Use your browser menu to install CompliScan.'); }
      }}>Install app</button>}
      {!install && !window.matchMedia('(display-mode: standalone)').matches && <span className="text-[10px]">Install from browser menu; iPhone: Share → Add to Home Screen.</span>}
      {update && <button disabled={busy} className="rounded-lg bg-blue-600 text-white px-3 py-2 disabled:opacity-50" onClick={() => updateServiceWorker(true)}>Update app{busy ? ' after scan' : ''}</button>}
      <button className="rounded-lg border border-blue-300 px-3 py-2" onClick={async () => {
        const granted = await navigator.storage?.persist?.().catch(() => false);
        setError(granted ? '' : 'Storage protection is browser-managed. Export important audits before clearing browser data.');
      }}>Protect local storage</button>
    </div>
  </aside>;
}
