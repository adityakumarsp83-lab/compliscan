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
  status: 'COMPLIANT' | 'VIOLATION' | 'NOTICE_PENDING';
  violations: string[];
  noticeRef?: string;
  curePeriodDays?: number;
}

export const PUNE_WARDS_AUDIT_DATA: StoreAuditRecord[] = [
  {
    id: 'STORE-PN-001',
    storeName: 'Aapla Bazaar Superstore',
    ward: 'Ward 8 - Fergusson College Rd',
    address: 'Shop 12, FC Road, Shivajinagar, Pune',
    lat: 18.5246,
    lng: 73.8415,
    lastInspectionDate: '07 Sep 2026, 11:20 AM',
    inspectorId: 'Insp. LM-MH-4091',
    productAudited: 'Kurkure Masala Munch (150g)',
    score: '10/10',
    status: 'COMPLIANT',
    violations: [],
  },
  {
    id: 'STORE-PN-002',
    storeName: 'Shree Ganesh Provision Stores',
    ward: 'Ward 4 - Swargate Transit Hub',
    address: 'Near Swargate Bus Stand, Pune',
    lat: 18.5018,
    lng: 73.8587,
    lastInspectionDate: '07 Sep 2026, 09:45 AM',
    inspectorId: 'Insp. LM-MH-4091',
    productAudited: 'Haldiram Aloo Bhujia (200g)',
    score: '7/10',
    status: 'NOTICE_PENDING',
    violations: [
      'Rule 6(11): Unit Sale Price (USP) arithmetic mismatch by ₹0.08/g',
      'Rule 6(1)(n): Consumer grievance phone number illegible',
    ],
    noticeRef: 'IN-2026-881204',
    curePeriodDays: 21,
  },
  {
    id: 'STORE-PN-003',
    storeName: 'Metro Daily Mart',
    ward: 'Ward 12 - Kothrud Depot',
    address: 'Paud Road, Ideal Colony, Kothrud, Pune',
    lat: 18.5074,
    lng: 73.8077,
    lastInspectionDate: '06 Sep 2026, 04:15 PM',
    inspectorId: 'Insp. LM-MH-3108',
    productAudited: 'Patanjali Pure Ghee (1L)',
    score: '5/10',
    status: 'VIOLATION',
    violations: [
      'Rule 7 Table I: Font height measured 1.42mm (Mandatory minimum: 4.0mm for 1L)',
      'Rule 6(1)(e): Dual-MRP sticker pasted over printed price',
      'Rule 6(11): Unit Sale Price completely omitted from PDP',
    ],
    noticeRef: 'IN-2026-904123',
    curePeriodDays: 14,
  },
  {
    id: 'STORE-PN-004',
    storeName: 'Royal Sweets & Dry Fruits',
    ward: 'Ward 2 - Pune Railway Station Area',
    address: 'Station Road, Agarkar Nagar, Pune',
    lat: 18.5284,
    lng: 73.8744,
    lastInspectionDate: '06 Sep 2026, 01:10 PM',
    inspectorId: 'Insp. LM-MH-4091',
    productAudited: 'Packed Kaju Katli (500g)',
    score: '6/10',
    status: 'VIOLATION',
    violations: [
      'Rule 6(1)(da): Date of Expiry / Best Before omitted',
      'Rule 6(1)(f): Country of origin declaration missing',
    ],
    noticeRef: 'IN-2026-348912',
    curePeriodDays: 21,
  },
  {
    id: 'STORE-PN-005',
    storeName: 'Viman Fresh Retail',
    ward: 'Ward 15 - Viman Nagar',
    address: 'Datta Mandir Chowk, Viman Nagar, Pune',
    lat: 18.5679,
    lng: 73.9143,
    lastInspectionDate: '05 Sep 2026, 05:30 PM',
    inspectorId: 'Insp. LM-MH-2004',
    productAudited: 'Tata Sampann Chana Dal (1kg)',
    score: '10/10',
    status: 'COMPLIANT',
    violations: [],
  },
];
