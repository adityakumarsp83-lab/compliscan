import { useEffect, useState } from 'react';
import { adminRequest, fetchAdminPhoto } from './apiClient';
import { hashImage } from './imageEvidence';
import { WardInspectionDashboard } from './WardMap';
import type { StoredInspection } from './inspectionStore';
interface Review { id: number; event_sequence: number; admin_username: string; action: string; note: string; received_at: string }
interface Event { sequence: number; inspection_id: string; actor_username: string; received_at: string; payload: StoredInspection & { revision_reason: string }; event_hash: string; previous_hash: string; flags: string[]; revisions?: number; integrity_valid?: boolean; chain_valid?: boolean; review?: Review }
interface Timeline { events: Event[]; reviews: Review[] }
export function AdminDashboard() {
  const [events,setEvents] = useState<Event[]>([]); const [updated,setUpdated] = useState(''); const [error,setError] = useState('');
  const [selected,setSelected] = useState(''); const [timeline,setTimeline] = useState<Timeline|null>(null);
  const [note,setNote] = useState(''); const [busy,setBusy] = useState(false); const [photo,setPhoto] = useState('');
  const [filter,setFilter] = useState('');
  const [legacy,setLegacy] = useState<StoredInspection[]>([]);
  useEffect(()=>{ void adminRequest<{data:StoredInspection[]}>('/legacy').then(result=>setLegacy(result.data)).catch(()=>{}); },[]);
  useEffect(() => {
    let active=true; let running=false;
    async function refresh() {
      if (running) return; running=true;
      try {
        const feed=await adminRequest<{data:Event[];received_at:string}>('/inspections');
        if (active) { setEvents(feed.data); setUpdated(feed.received_at); setError(''); }
      } catch(error) { if (active) setError(error instanceof Error?error.message:'Cannot refresh live feed'); }
      finally { running=false; }
    }
    void refresh(); const timer=setInterval(()=>void refresh(),5000);
    return ()=>{ active=false; clearInterval(timer); };
  },[]);
  useEffect(() => {
    let active=true; setTimeline(null); setNote('');
    if (selected) void adminRequest<Timeline>(`/inspections/${selected}`).then(value=>{if(active)setTimeline(value);}).catch(error=>{if(active)setError(error.message);});
    return ()=>{active=false;};
  },[selected,events.find(event=>event.inspection_id===selected)?.sequence]);
  useEffect(()=>()=>{ if(photo) URL.revokeObjectURL(photo); },[photo]);
  async function review(action: string) {
    const latest=timeline?.events.at(-1); if (!latest) return;
    setBusy(true);
    try {
      await adminRequest('/reviews',{sequence:Number(latest.sequence),action,note});
      setTimeline(await adminRequest<Timeline>(`/inspections/${selected}`)); setNote('');
    } catch(error) { setError(error instanceof Error?error.message:'Review failed'); }
    finally { setBusy(false); }
  }
  async function preview(sha: string) {
    setBusy(true);
    try { const blob=await fetchAdminPhoto(sha); if(await hashImage(blob)!==sha) throw new Error('Original photograph failed SHA-256 verification'); setPhoto(URL.createObjectURL(blob)); }
    catch(error) { setError(error instanceof Error?error.message:'Photo unavailable'); } finally {setBusy(false);}
  }
  const visible=events.filter(event=>`${event.payload.product_name} ${event.actor_username} ${event.payload.inspector_id}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="space-y-5 mt-5">
    <div className="bg-white p-5 border rounded-xl">
      <h2 className="font-bold text-xl">Admin supervision</h2>
      <p className="text-sm mt-2 text-slate-600">Central inspection archive · refreshes every 5 seconds · last successful refresh: {updated?new Date(updated).toLocaleString():'Awaiting server'}</p>
      <p className="text-xs mt-2 text-slate-500">Offline submissions appear after they sync. Rule findings and device locations are client-reported; inspect the original photographs when reviewing a case. Review flags do not prove misconduct. Showing the latest 500 inspections.</p>
      {error && <p role="alert" className="p-3 mt-3 bg-rose-50 text-rose-800 rounded-lg">{error} — previously loaded data may be stale.</p>}
      <div className="flex gap-6 mt-4 text-sm"><span>{events.length} inspections</span><span>{events.filter(event=>event.flags.length&&!event.review).length} awaiting review</span><span>{events.filter(event=>event.review?.action==='ESCALATED').length} escalated</span></div>
    </div>
    <WardInspectionDashboard records={events.map(event=>event.payload)} />
    {legacy.length > 0 && <details className="bg-white border rounded-xl p-4 text-sm"><summary>Earlier server records ({legacy.length}) — original evidence and ledger integrity unverified</summary><p className="mt-2 text-slate-500">These predate the central evidence archive. They are preserved as earlier records and are not counted as new live inspections. Showing the latest 100.</p>{legacy.map(record=><p key={record.id} className="mt-2">{record.product_name} · {record.inspector_name} · {record.inspector_id} · {record.score} · {new Date(record.timestamp).toLocaleString()}</p>)}</details>}
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="bg-white p-4 border rounded-xl">
        <input aria-label="Search central inspections" placeholder="Search inspector or product" value={filter} onChange={event=>setFilter(event.target.value)} className="w-full border p-2 rounded-lg mb-3" />
        {!events.length && <p className="text-sm text-slate-500">No centrally acknowledged inspections yet.</p>}
        <div className="space-y-3 max-h-[650px] overflow-auto">{visible.map(event=><button key={event.inspection_id} onClick={()=>setSelected(event.inspection_id)} className="text-left w-full border rounded-lg p-3 hover:bg-blue-50">
          <strong>{event.payload.product_name}</strong><p className="text-sm">{event.payload.inspector_name} · {event.actor_username} · #{event.payload.inspector_id}</p>
          <p className="text-xs mt-1">Captured: {new Date(event.payload.timestamp).toLocaleString()}<br/>Server received: {new Date(event.received_at).toLocaleString()} · Score {event.payload.score} · {event.revisions} revision(s)</p>
          <p className="text-xs mt-2 text-amber-800">{event.flags.map(flag=>flag.replaceAll('_',' ')).join(' · ') || 'No review flags'}</p>
          {event.review && <p className="text-xs mt-1 text-blue-700">{event.review.action} by {event.review.admin_username}</p>}
        </button>)}</div>
      </div>
      <div className="bg-white p-4 border rounded-xl">
        <h3 className="font-bold">Inspection revision timeline</h3>
        {!selected && <p className="text-sm mt-2 text-slate-500">Select an inspection to review its original evidence and corrections.</p>}
        {selected && !timeline && <p className="mt-2 text-sm">Loading timeline…</p>}
        {timeline?.events.map(event=>{
          const report=JSON.parse(event.payload.report_json);
          return <section key={event.sequence} className="border rounded-lg p-3 mt-3 text-xs">
            <strong>Revision #{event.sequence} · {event.payload.score}</strong>
            <p>Received {new Date(event.received_at).toLocaleString()} from {event.actor_username}</p>
            <p className={event.integrity_valid?'text-emerald-700':'text-rose-700'}>{event.integrity_valid?'Ledger hash verified':'Ledger integrity failure'}</p>
            <p className="mt-2">Correction reason: {event.payload.revision_reason || 'Not supplied'}</p>
            <p className="break-all mt-2 font-mono">Event SHA-256: {event.event_hash}</p>
            <p className="mt-2 text-amber-800">{event.flags.map(flag=>flag.replaceAll('_',' ')).join(' · ')}</p>
            <details className="mt-2"><summary>Recorded rule results</summary>{report.results.map((result:{ruleId:string;status:string;details:string},index:number)=><p key={index} className="mt-2">{result.ruleId}: {result.status} — {result.details}</p>)}</details>
            {report.evidence?.images?.map((image:{sha256:string;surface:string;fileName:string},index:number)=><button key={index} disabled={busy} onClick={()=>void preview(image.sha256)} className="block mt-2 text-blue-700 underline">Verify and view original: {image.surface} ({image.fileName})</button>)}
          </section>;
        })}
        {timeline && <div className="mt-4 text-sm">
          {timeline.reviews.map(review=><p key={review.id} className="border-b py-2">{review.action} · {review.admin_username} · revision #{review.event_sequence}<br/>{review.note}</p>)}
          <label className="block mt-3">Review note<input aria-label="Admin review note" value={note} onChange={event=>setNote(event.target.value)} maxLength={2000} className="block w-full border rounded-lg p-2 mt-1" /></label>
          <div className="flex gap-3 mt-3"><button disabled={busy||!note.trim()} onClick={()=>void review('REVIEWED')} className="border rounded-lg p-2 disabled:opacity-40">Mark reviewed</button><button disabled={busy||!note.trim()} onClick={()=>void review('ESCALATED')} className="border rounded-lg p-2 text-rose-700 disabled:opacity-40">Escalate</button></div>
        </div>}
      </div>
    </div>
    {photo && <div className="fixed inset-0 z-[2000] bg-black/80 flex flex-col items-center justify-center p-5"><button className="bg-white rounded-lg p-2 mb-3" onClick={()=>setPhoto('')}>Close verified photograph</button><img src={photo} alt="SHA-256 verified original inspection evidence" className="max-h-[80vh] max-w-full" /></div>}
  </div>;
}
