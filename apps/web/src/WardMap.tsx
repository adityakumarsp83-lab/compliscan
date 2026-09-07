import { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { MapPin, AlertCircle, ShieldCheck, Search } from 'lucide-react';
import { PUNE_WARDS_AUDIT_DATA } from './wardData';
import type { StoreAuditRecord } from './wardData';
import 'leaflet/dist/leaflet.css';

// Component to dynamically recenter the map on store selection
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  map.setView([lat, lng], 14, { animate: true });
  return null;
}

export function WardInspectionDashboard() {
  const stores = PUNE_WARDS_AUDIT_DATA;
  const [selectedStore, setSelectedStore] = useState<StoreAuditRecord | null>(stores[0]);
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
  const pendingCount = stores.filter((s) => s.status === 'NOTICE_PENDING').length;
  const violationCount = stores.filter((s) => s.status === 'VIOLATION').length;
  const complianceRate = Math.round((compliantCount / totalAudited) * 100);

  const getMarkerColor = (status: StoreAuditRecord['status']) => {
    switch (status) {
      case 'COMPLIANT':
        return '#10b981'; // emerald-500
      case 'NOTICE_PENDING':
        return '#f59e0b'; // amber-500
      case 'VIOLATION':
        return '#f43f5e'; // rose-500
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Ward KPI Telemetry Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-mono text-slate-400 block mb-1">STORES AUDITED</span>
          <div className="text-2xl font-bold font-mono text-slate-100">{totalAudited}</div>
          <span className="text-[11px] text-slate-500 mt-1 block">Pune Urban & Sub-wards</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-mono text-slate-400 block mb-1">WARD COMPLIANCE</span>
          <div className="text-2xl font-bold font-mono text-emerald-400">{complianceRate}%</div>
          <span className="text-[11px] text-emerald-500/80 mt-1 block">
            {compliantCount} of {totalAudited} Verified Fully Compliant
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-mono text-slate-400 block mb-1">21-DAY CURE NOTICES</span>
          <div className="text-2xl font-bold font-mono text-amber-400">{pendingCount}</div>
          <span className="text-[11px] text-amber-500/80 mt-1 block">Jan Vishwas Act Form A-1 Active</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-mono text-slate-400 block mb-1">CRITICAL OFFENSES</span>
          <div className="text-2xl font-bold font-mono text-rose-400">{violationCount}</div>
          <span className="text-[11px] text-rose-500/80 mt-1 block">Flagged for Penalty Compounding</span>
        </div>
      </div>

      {/* Main Map + Sidebar Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Store Register */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Search & Filter Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search store, ward, or product..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs font-sans text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-1.5 flex-wrap text-xs">
              {['ALL', 'COMPLIANT', 'NOTICE_PENDING', 'VIOLATION'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-2.5 py-1 rounded-md font-mono text-[11px] transition ${
                    filterStatus === status
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

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
                      ? 'bg-slate-900 border-indigo-500 shadow-md ring-1 ring-indigo-500/30'
                      : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="font-semibold text-sm text-slate-100">{store.storeName}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{store.ward}</p>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        store.status === 'COMPLIANT'
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          : store.status === 'NOTICE_PENDING'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                      }`}
                    >
                      {store.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span>{store.productAudited}</span>
                    <span className="font-bold text-slate-200">Score: {store.score}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Leaflet Map & Selected Store Inspection Details */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm h-[380px] relative">
            <MapContainer
              center={[18.5204, 73.8567]}
              zoom={12}
              style={{ height: '100%', width: '100%', background: '#020617' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {selectedStore && <MapRecenter lat={selectedStore.lat} lng={selectedStore.lng} />}

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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-3 border-b border-slate-800 gap-2">
                <div>
                  <h3 className="font-bold text-base text-slate-100">{selectedStore.storeName}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    {selectedStore.address}
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-400">
                  Officer: <strong className="text-slate-200">{selectedStore.inspectorId}</strong>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs">
                  <span className="text-slate-500 block mb-1">AUDITED PRODUCT</span>
                  <span className="font-semibold text-slate-200">{selectedStore.productAudited}</span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs">
                  <span className="text-slate-500 block mb-1">INSPECTION TIMESTAMP</span>
                  <span className="font-mono text-slate-200">{selectedStore.lastInspectionDate}</span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs">
                  <span className="text-slate-500 block mb-1">VERDICT SCORE</span>
                  <span className="font-mono font-bold text-emerald-400">{selectedStore.score} Met</span>
                </div>
              </div>

              {selectedStore.violations.length > 0 ? (
                <div className="mt-4 p-3.5 bg-amber-950/20 border border-amber-500/30 rounded-xl flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5 font-mono">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      Statutory Violations Logged ({selectedStore.noticeRef})
                    </span>
                    <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded">
                      {selectedStore.curePeriodDays}-Day Cure Period
                    </span>
                  </div>
                  <ul className="space-y-1.5 mt-1">
                    {selectedStore.violations.map((violation, idx) => (
                      <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{violation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 p-3.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-300 text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>All 10 mandatory declarations verified. No statutory violations detected.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
