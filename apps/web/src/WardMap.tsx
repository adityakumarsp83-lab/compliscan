import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { MapPin, AlertCircle, ShieldCheck, Search } from 'lucide-react';
import { inspectionStatus, locationText } from './inspectionMetadata';
import type { StoredInspection } from './inspectionStore';
import type { ComplianceReport } from './engine';
import type { StoreAuditRecord } from './wardData';
import 'leaflet/dist/leaflet.css';

function MapLayout({ stores }: { stores: StoreAuditRecord[] }) {
  const map = useMap();
  const positions = stores.map(store=>`${store.lat},${store.lng}`).join(';');
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ animate:false }));
    observer.observe(map.getContainer());
    map.invalidateSize({ animate:false });
    if (stores.length) map.fitBounds(stores.map(store => [store.lat,store.lng] as [number,number]), { padding:[35,35], maxZoom:15, animate:false });
    else map.setView([0,0],2,{ animate:false });
    return () => observer.disconnect();
  },[map,positions]);
  return null;
}
function RiskHeatLayer({ stores }: { stores: StoreAuditRecord[] }) {
  const map = useMap();
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'risk-heat-layer';
    Object.assign(canvas.style,{ position:'absolute',inset:'0',zIndex:'350',pointerEvents:'none' });
    map.getContainer().append(canvas);
    const draw = () => {
      const size = map.getSize(); canvas.width=size.x; canvas.height=size.y;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      for (const store of stores.filter(store=>store.status!=='COMPLIANT')) {
        const point = map.latLngToContainerPoint([store.lat,store.lng]);
        const radius = store.status==='VIOLATION'?60:42;
        const gradient = ctx.createRadialGradient(point.x,point.y,2,point.x,point.y,radius);
        gradient.addColorStop(0,store.status==='VIOLATION'?'rgba(244,63,94,.65)':'rgba(245,158,11,.45)');
        gradient.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=gradient;
        ctx.fillRect(point.x-radius,point.y-radius,radius*2,radius*2);
      }
    };
    draw(); map.on('move zoom resize',draw);
    return () => { map.off('move zoom resize',draw); canvas.remove(); };
  },[map,stores]);
  return null;
}

export function WardInspectionDashboard({ records }: { records: StoredInspection[] }) {
  const stores = useMemo(() => records.flatMap((record): StoreAuditRecord[] => {
    try {
      const report = JSON.parse(record.report_json) as ComplianceReport;
      const location = report.inspection?.location;
      if (location?.status !== 'recorded' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude!) > 90 || Math.abs(location.longitude!) > 180) return [];
      return [{ id: record.id, storeName: record.product_name, ward: locationText(location),
        address: locationText(location), lat: location.latitude!, lng: location.longitude!,
        lastInspectionDate: new Date(record.timestamp).toLocaleString(), inspectorId: record.inspector_id || 'Not recorded',
        productAudited: record.product_name, score: record.score, status: inspectionStatus(record),
        violations: (report.results || []).filter((result) => result.status !== 'PASS').map((result) => result.details) }];
    } catch { return []; }
  }), [records]);
  const [selectedStore, setSelectedStore] = useState<StoreAuditRecord | null>(null);
  useEffect(() => { setSelectedStore((previous) => stores.find((store) => store.id === previous?.id) || stores[0] || null); }, [stores]);
  const [tileError,setTileError] = useState(false);
  const [showHeat,setShowHeat] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredStores = stores.filter((s) => {
    const matchesFilter = filterStatus === 'ALL' || s.status === filterStatus;
    const matchesSearch =
      s.storeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.ward.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.productAudited.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const totalAudited = stores.length;
  const compliantCount = stores.filter((s) => s.status === 'COMPLIANT').length;
  const pendingCount = stores.filter((s) => s.status === 'REVIEW').length;
  const violationCount = stores.filter((s) => s.status === 'VIOLATION').length;
  const complianceRate = totalAudited ? Math.round((compliantCount / totalAudited) * 100) : 0;

  const getMarkerColor = (status: StoreAuditRecord['status']) => {
    switch (status) {
      case 'COMPLIANT':
        return '#10b981'; // emerald-500
      case 'REVIEW':
        return '#f59e0b'; // amber-500
      case 'VIOLATION':
        return '#f43f5e'; // rose-500
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Ward KPI Telemetry Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-mono text-slate-500 block mb-1">MAPPED INSPECTIONS</span>
          <div className="text-2xl font-bold font-mono text-slate-800">{totalAudited}</div>
          <span className="text-[11px] text-slate-400 mt-1 block">{records.length - stores.length} inspections without recorded coordinates</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-mono text-slate-500 block mb-1">RULES PASSED</span>
          <div className="text-2xl font-bold font-mono text-emerald-600">{complianceRate}%</div>
          <span className="text-[11px] text-emerald-600 mt-1 block">
            {compliantCount} of {totalAudited} with every rule passed
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-mono text-slate-500 block mb-1">REQUIRES REVIEW</span>
          <div className="text-2xl font-bold font-mono text-amber-600">{pendingCount}</div>
          <span className="text-[11px] text-amber-600 mt-1 block">Review warnings in saved reports</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-mono text-slate-500 block mb-1">FLAGGED FINDINGS</span>
          <div className="text-2xl font-bold font-mono text-rose-600">{violationCount}</div>
          <span className="text-[11px] text-rose-600 mt-1 block">Inspections with failed checks</span>
        </div>
      </div>

      {/* Main Map + Sidebar Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Store Register */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Search & Filter Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search product or coordinates..."
                className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-xs font-sans text-slate-700 placeholder-slate-400 focus:outline-none focus:border-fda-500 focus:ring-2 focus:ring-fda-500/20"
              />
            </div>

            <div className="flex gap-1.5 flex-wrap text-xs">
              {['ALL', 'COMPLIANT', 'REVIEW', 'VIOLATION'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-2.5 py-1 rounded-md font-mono text-[11px] transition ${
                    filterStatus === status
                      ? 'bg-fda-600 text-white font-semibold shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {records.length > stores.length && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
            <strong>Inspections without location</strong>
            {records.filter(record=>!stores.some(store=>store.id===record.id)).map(record=><p key={record.id} className="mt-2">{record.product_name} · {record.inspector_id} · {new Date(record.timestamp).toLocaleString()} — cannot place on map</p>)}
          </div>}
          {/* Store List */}
          <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
            {filteredStores.map((store) => {
              const isSelected = selectedStore?.id === store.id;
              return (
                <div
                  key={store.id}
                  onClick={() => setSelectedStore(store)}
                  className={`p-4 rounded-xl border cursor-pointer transition ${
                    isSelected
                      ? 'bg-blue-50/50 border-fda-500 shadow-sm ring-1 ring-fda-500/20'
                      : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="font-semibold text-sm text-slate-800">{store.storeName}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{store.ward}</p>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        store.status === 'COMPLIANT'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : store.status === 'REVIEW'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {store.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
                    <span>{store.productAudited}</span>
                    <span className="font-bold text-slate-700">Score: {store.score}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Leaflet Map & Selected Store Inspection Details */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
            <label><input type="checkbox" checked={showHeat} onChange={event=>setShowHeat(event.target.checked)} /> Show risk heat layer</label>
            <p className="mt-2">Green: all checks passed · Amber: review required · Red: failed checks. Overlapping findings increase intensity.</p>
            {!stores.length && <p className="mt-2">No inspections with device coordinates yet. Allow location access over HTTPS and scan a product. The map shows an overview until real coordinates are recorded.</p>}
            {(tileError || !navigator.onLine) && <p className="mt-2 text-amber-700">Background map tiles unavailable. Recorded inspection markers and the heat layer remain available.</p>}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm h-[380px] relative">
            <MapContainer
              center={stores.length ? [stores[0].lat, stores[0].lng] : [0,0]}
              zoom={stores.length ? 12 : 2}
              zoomAnimation={false}
              fadeAnimation={false}
              scrollWheelZoom={false}
              style={{ height: '100%', width: '100%', background: '#f8fafc' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{ tileerror:()=>setTileError(true) }}
              />

              <MapLayout stores={stores} />
              {showHeat && <RiskHeatLayer stores={filteredStores} />}

              {filteredStores.map((store) => (
                <CircleMarker
                  key={store.id}
                  center={[store.lat, store.lng]}
                  radius={selectedStore?.id === store.id ? 11 : 8}
                  pathOptions={{
                    color: getMarkerColor(store.status),
                    fillColor: getMarkerColor(store.status),
                    fillOpacity: 0.85,
                    weight: selectedStore?.id === store.id ? 3 : 1.5,
                  }}
                  eventHandlers={{
                    click: () => setSelectedStore(store),
                  }}
                >
                  <Popup>
                    <div className="text-slate-900 text-xs font-sans">
                      <strong>{store.storeName}</strong>
                      <p className="text-slate-600 mt-0.5">{store.productAudited}</p>
                      <p className="font-mono mt-1 font-semibold">Score: {store.score}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>

          {selectedStore && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-3 border-b border-slate-100 gap-2">
                <div>
                  <h3 className="font-bold text-base text-slate-800">{selectedStore.storeName}</h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-fda-600" />
                    {selectedStore.address}
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-500">
                  Officer: <strong className="text-slate-700">{selectedStore.inspectorId}</strong>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                  <span className="text-slate-400 block mb-1">AUDITED PRODUCT</span>
                  <span className="font-semibold text-slate-700">{selectedStore.productAudited}</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                  <span className="text-slate-400 block mb-1">INSPECTION TIMESTAMP</span>
                  <span className="font-mono text-slate-700">{selectedStore.lastInspectionDate}</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                  <span className="text-slate-400 block mb-1">VERDICT SCORE</span>
                  <span className="font-mono font-bold text-emerald-600">{selectedStore.score} Met</span>
                </div>
              </div>

              {selectedStore.violations.length > 0 ? (
                <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5 font-mono">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      Saved audit findings
                    </span>

                  </div>
                  <ul className="space-y-1.5 mt-1">
                    {selectedStore.violations.map((violation, idx) => (
                      <li key={idx} className="text-xs text-slate-700 flex items-start gap-2">
                        <span className="text-amber-500 font-bold">•</span>
                        <span>{violation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>All checks in this saved report passed.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
