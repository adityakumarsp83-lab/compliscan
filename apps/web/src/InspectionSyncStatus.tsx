import { useEffect, useState } from 'react';
import { pendingInspections, acknowledgeInspection, queueEarlierInspections } from './inspectionStore';
import { getToken, getStoredUser, saveToBackendHistory } from './apiClient';
let flushing = false;
export async function flushInspectionQueue(owner: string): Promise<void> {
  if (flushing || !navigator.onLine || !getToken()) return;
  flushing = true;
  try {
    for (const event of await pendingInspections(owner)) {
      if (!getToken() || getStoredUser()?.userId !== owner) break;
      const receipt = await saveToBackendHistory(event);
      await acknowledgeInspection(event,receipt);
    }
  } finally { flushing = false; }
}
export function InspectionSyncStatus({ owner }: { owner: string }) {
  const [pending,setPending] = useState(0); const [error,setError] = useState(''); const [sending,setSending] = useState(false);
  useEffect(() => {
    let active = true;
    async function update() {
      if (!active) return;
      const items = await pendingInspections(owner);
      if (!active) return;
      setPending(items.length);
      if (!items.length) { setError(''); return; }
      if (!navigator.onLine) { setError('Offline — saved on this device'); return; }
      if (!getToken()) { setError('Sign in again to send these inspections'); return; }
      setSending(true);
      try { await flushInspectionQueue(owner); if (active) setError(''); }
      catch (error) { if (active) setError(error instanceof Error ? error.message : 'Upload pending'); }
      finally { if (active) { setSending(false); setPending((await pendingInspections(owner)).length); } }
    }
    void queueEarlierInspections(owner,getStoredUser()?.inspectorId || '').then(update).catch(()=>{ if(active)setError('Earlier local records could not be queued; free storage and reload'); }); const timer = window.setInterval(() => void update(),10000);
    const refresh = () => void update(); window.addEventListener('inspection-saved',refresh); window.addEventListener('online',refresh);
    return () => { active=false; clearInterval(timer); window.removeEventListener('inspection-saved',refresh); window.removeEventListener('online',refresh); };
  },[owner]);
  return <div role="status" className={`px-4 py-2 text-xs border-b ${pending ? 'bg-amber-50 text-amber-900':'bg-slate-50 text-slate-600'}`}>
    Central archive: {pending ? `${pending} submission${pending===1?'':'s'} pending${sending?' — sending…':''}`:'No pending submissions on this device'}{error && ` · ${error}`}. Offline records reach admins after reconnection and sign-in.
  </div>;
}
