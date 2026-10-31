export type Role = 'owner' | 'sales' | 'broker' | 'accountant';
export type Status = 'available' | 'booked' | 'sold';
export type Dir = 'N' | 'E' | 'S' | 'W';

export interface Org {
  id: string;
  name: string;
  reg_days: number;
  pay_days: number;
  timezone: string;
  is_demo: boolean;
}

/** % of the sale value, or a fixed ₹ per sq ft */
export type CommissionType = 'percent' | 'per_sqft';

export interface Profile {
  id: string;
  org_id: string | null;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  commission_rate: number;
  commission_type: CommissionType;
  monthly_salary: number;
  active: boolean;
  /** WhatsApp alerts and (owner) daily summary, opted in by the person themselves */
  whatsapp_alerts: boolean;
  whatsapp_summary: boolean;
}

export interface Road { x: number; y: number; w: number; h: number }
export interface Park { pts: string; t: string[]; cx: number; cy: number; dp?: [number, number] }
export interface RoadLabel { t: string; x: number; y: number; r?: number }

export interface Layout {
  w: number;
  h: number;
  roads: Road[];
  diag?: number[][];
  parks: Park[];
  labels: RoadLabel[];
  compass?: [number, number];
  /** photo or PDF page of the layout drawing, shown behind the plots (path in the `layouts` bucket) */
  image?: { path: string; w: number; h: number } | null;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  location: string;
  lat: number | null;
  lng: number | null;
  approval: string | null;
  launched: string | null;
  guideline_rate: number;
  sale_rate: number;
  rate_updated_by: string | null;
  rate_updated_at: string | null;
  layout: Layout;
  created_at: string;
  /** plots: a layout drawing of plots · apartments: towers, floors and flats */
  kind: 'plots' | 'apartments';
  rera_no: string | null;
  /** apartment pricing, in paise: floor rise per sq ft for each floor above floor_rise_from, and per car park */
  floor_rise_paise: number;
  floor_rise_from: number;
  parking_paise: number;
  /** GST shown to buyers, in basis points (500 = 5%) */
  gst_bp: number;
}

export interface Tower {
  id: string;
  project_id: string;
  name: string;
  floors: number;
  sort: number;
}

export interface UnitType {
  id: string;
  project_id: string;
  name: string;
  bedrooms: number | null;
  carpet_sqft: number;
  builtup_sqft: number;
  saleable_sqft: number;
  /** floor plan picture in the layouts bucket */
  plan_path: string | null;
  sort: number;
}

export interface PlotGeom { x: number; y: number; w: number; h: number; pts?: string | null }

export interface Plot {
  id: string;
  project_id: string;
  org_id: string;
  label: string;
  geom: PlotGeom;
  front_ft: number;
  depth_ft: number;
  sqft: number;
  facing: Dir[];
  status: Status;
  rate_override: number | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  /** buyer agreed to WhatsApp messages (Meta requires consent); SMS is sent either way */
  buyer_whatsapp: boolean;
  paid: number;
  due_date: string | null;
  reg_date: string | null;
  registered: boolean;
  sold_by: string | null;
  /** commission deal frozen when the plot was sold */
  commission_rate: number | null;
  commission_type: CommissionType | null;
  updated_at: string;
  /** flats only: tower, floor, unit type, preferred location charge (paise) and car parks */
  tower_id: string | null;
  floor: number | null;
  unit_type_id: string | null;
  plc_paise: number;
  parking_slots: number;
}

export type NewPlot = Pick<Plot, 'label' | 'geom' | 'front_ft' | 'depth_ft' | 'sqft' | 'facing'>;

export interface PlotEvent {
  id: string;
  plot_id: string;
  org_id: string;
  actor: string | null;
  /** who handles the plot (salesperson or broker), for the team leaderboard */
  member: string | null;
  kind: 'booked' | 'sold' | 'payment' | 'registration' | 'registered' | 'cancelled' | 'price' | 'other' | null;
  text: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  recipient: string;
  actor: string | null;
  kind: string;
  text: string;
  plot_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface CostLine { id: string; project_id: string; category: string; party: string; committed: number; paid: number }
export interface Funding { project_id: string; bank: number; credit: number; cash: number }
export interface CommissionPayment { id: string; member_id: string; project_id: string; amount: number; paid_on: string }

export interface CustomerMessage {
  id: string;
  plot_id: string | null;
  to_name: string;
  to_phone: string;
  kind: string;
  body: string;
  whatsapp_status: string;
  sms_status: string;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  commission_rate: number;
  commission_type: CommissionType;
  accepted_at: string | null;
}

export interface Account {
  id: string;
  name: string;
  kind: 'bank' | 'cash';
  bank_name: string | null;
  last4: string | null;
  opening_balance: number;
  active: boolean;
}

export type LedgerSource = 'customer_payment' | 'expense' | 'commission' | 'salary' | 'income' | 'other_expense' | 'transfer' | 'asset';

/** One movement of money in or out of a bank or cash account. */
export interface LedgerEntry {
  id: string;
  account_id: string | null;
  project_id: string | null;
  plot_id: string | null;
  member_id: string | null;
  direction: 'in' | 'out';
  amount: number;
  txn_date: string;
  category: string;
  party: string | null;
  note: string | null;
  source: LedgerSource;
  source_id: string | null;
  created_at: string;
}

export type PayMode = 'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'card' | 'other';

export interface CustomerPayment {
  id: string;
  plot_id: string;
  amount: number;
  received_on: string;
  receipt_no: number;
  mode: PayMode | null;
  reference: string | null;
  buyer_name: string | null;
  account_id: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface Installment { id: string; plot_id: string; due_date: string; amount: number; note: string | null }

export interface Asset {
  id: string;
  name: string;
  category: string;
  purchase_date: string;
  cost: number;
  depreciation_pct: number;
  note: string | null;
  disposed_on: string | null;
}

export interface PlotDocument { id: string; plot_id: string; name: string; kind: string; path: string; size_bytes: number | null; uploaded_by: string | null; created_at: string }
