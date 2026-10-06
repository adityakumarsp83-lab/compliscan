export interface StoreAuditRecord {
  id: string;
  storeName: string;
  ward: string;
  address: string;
  lat: number;
  lng: number;
  lastInspectionDate: string;
  inspectorId: string;
  productAudited: string;
  score: string;
  status: 'COMPLIANT' | 'VIOLATION' | 'REVIEW';
  violations: string[];
}

// Map records are derived from original saved inspections; there are no seeded stores.
