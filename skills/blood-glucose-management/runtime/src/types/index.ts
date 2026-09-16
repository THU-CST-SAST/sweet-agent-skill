// Basic types for the app
export interface User {
  id: number;
  name: string;
  email: string;
}

// Nightscout API types
export interface GlucoseEntry {
  _id: string;
  sgv: number; // Sensor glucose value
  date: number; // Unix timestamp in milliseconds
  dateString: string;
  trend: number; // Trend indicator
  direction: string; // Arrow direction (DoubleUp, SingleUp, Flat, etc.)
  device: string;
  type: string;
}

export interface TreatmentEntry {
  _id: string;
  eventType: string; // 'Meal Bolus', 'Correction Bolus', 'Carb Correction', 'Temp Basal', 'BG Check', 'Note', etc.
  created_at: string;
  timestamp: string;
  insulin?: number; // Bolus insulin amount
  carbs?: number; // Carbohydrate amount
  duration?: number; // For temp basal (in minutes)
  absolute?: number; // For temp basal rate
  rate?: number; // Basal rate
  notes?: string;
  temp?: string; // For temp basal type
  automatic?: boolean; // Whether this is automatic
  glucose?: number; // Blood glucose value (for BG Check)
  glucoseType?: string; // Type of glucose measurement (e.g., 'Finger', 'Sensor')
  units?: string; // Units for glucose (e.g., 'mg/dL', 'mmol/L')
  enteredBy?: string; // Who entered the treatment
  recognitionRecordId?: number;
  source?: 'manual' | 'ai_recognition' | string;
  foodSummary?: string;
  imagePath?: string;
  imageUrl?: string;
  foods?: TreatmentFoodEntry[];
  mealImpactAnalysis?: TreatmentMealImpactAnalysis | null;
}

export interface TreatmentFoodEntry {
  id?: number;
  name: string;
  nameNormalized?: string;
  weight_g?: number;
  carbs: number;
  carbs_per_100g?: number;
  calories?: number;
  glycemic_index_level?: 'high' | 'medium' | 'low';
  estimated_gl?: number;
  estimated_bg_impact?: 'high' | 'medium' | 'low';
  confidence?: 'high' | 'medium' | 'low';
}

export interface TreatmentMealImpactAnalysis {
  id?: number;
  treatmentId?: number;
  summary: string;
  glucoseImpact: string;
  insulinAssessment: string;
  foodAssessment: string;
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high' | string;
  confidence: 'low' | 'medium' | 'high' | string;
  creditsConsumed?: number;
  analyzedAt?: string | null;
  updatedAt?: string | null;
}

// Profile types for basal insulin configuration
export interface BasalEntry {
  time: string; // Time in HH:MM format
  value: number; // Basal rate in U/h
  timeAsSeconds: number; // Time as seconds from midnight
}

export interface ProfileStore {
  basal: BasalEntry[];
  sens: Array<{ time: string; value: number; timeAsSeconds: number }>;
  carbratio: Array<{ time: string; value: number; timeAsSeconds: number }>;
  target_low: Array<{ time: string; value: number; timeAsSeconds: number }>;
  target_high: Array<{ time: string; value: number; timeAsSeconds: number }>;
  timezone: string;
  units: string;
  dia: number;
  carbs_hr: string;
  delay: string;
}

export interface Profile {
  _id: string;
  defaultProfile: string;
  store: {
    Default: ProfileStore;
  };
  startDate: string;
  mills: string | number;
  units: string;
  enteredBy: string;
}

export interface NightscoutConfig {
  url: string;
  apiToken?: string;
}

export type TimeRange = '2h' | '3h' | '4h' | '6h' | '12h' | '24h';

export type StatisticsTimeRange =
  | 'today'
  | '24h'
  | '7d'
  | '15d'
  | '30d'
  | '90d';

export interface GlucoseData {
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile | null;
  lastUpdate: number;
}

// Device Status types
export interface PumpInfo {
  model?: string;
  bolusing?: boolean;
  clock?: string;
  pumpID?: string;
  suspended?: boolean;
  secondsFromGMT?: number;
  battery?: {
    percent?: number;
  };
  manufacturer?: string;
  reservoir?: number;
  status?: {
    status?: string;
    timestamp?: string;
  };
  extended?: {
    Version?: string;
    ActiveProfile?: string;
    TempBasalAbsoluteRate?: number;
    TempBasalStart?: string;
    TempBasalRemaining?: number;
  };
}

export interface LoopInfo {
  name: string;
  iob: {
    iob: number;
    timestamp: string;
  };
  cob: {
    timestamp: string;
    cob: number;
  };
  enacted: {
    received: boolean;
    duration: number;
    timestamp: string;
    bolusVolume: number;
    rate: number;
  };
  predicted?: {
    values: number[];
  };
  timestamp: string;
  version: string;
}

export interface UploaderInfo {
  name: string;
  battery: number;
  timestamp: string;
}

// AAPS (AndroidAPS) / OpenAPS types
export interface OpenAPSIOB {
  iob: number;
  basaliob: number;
  activity: number;
  time: string;
}

export interface OpenAPSSuggested {
  temp?: string;
  bg?: number;
  tick?: string;
  eventualBG?: number;
  snoozeBG?: number;
  predBGs?: {
    IOB?: number[];
    [key: string]: number[] | undefined;
  };
  COB?: number;
  IOB?: number;
  reason?: string;
  duration?: number;
  rate?: number;
  timestamp?: string;
}

export interface OpenAPSInfo {
  suggested?: OpenAPSSuggested;
  iob?: OpenAPSIOB;
  enacted?: {
    received?: boolean;
    duration?: number;
    timestamp?: string;
    bolusVolume?: number;
    rate?: number;
  };
}

export interface DeviceStatus {
  _id: string;
  created_at: string;
  loop?: LoopInfo;
  openaps?: OpenAPSInfo; // AAPS support
  pump?: PumpInfo;
  uploader?: UploaderInfo;
  device: string;
  utcOffset?: number;
  mills: number;
  uploaderBattery?: number; // AAPS uses this field
  configuration?: Record<string, unknown>; // AAPS configuration object
}

// Data Source types
export type DataSourceType = 'nightscout' | 't1care' | 'manual';

export type CGMType =
  | 'nightscout'
  | 'silicone'
  | 'sanuo'
  | 'outaibang'
  | 'weitai'
  | 'abbott'
  | 'dekang';

export interface CGMSourceInfo {
  id: CGMType;
  name: string;
  icon?: string;
  description?: string;
}

export const CGM_SOURCES: Record<CGMType, CGMSourceInfo> = {
  nightscout: { id: 'nightscout', name: 'Nightscout' },
  silicone: { id: 'silicone', name: '硅基' },
  sanuo: { id: 'sanuo', name: '三诺' },
  outaibang: { id: 'outaibang', name: '欧态' },
  weitai: { id: 'weitai', name: '微泰' },
  abbott: { id: 'abbott', name: '雅培瞬感通' },
  dekang: { id: 'dekang', name: '德康' },
};

export interface T1CareConfig {
  username: string;
  password: string;
  cgmType: CGMType;
  apiUrl?: string;
}

export interface DataSourceConfig {
  type: DataSourceType;
  nightscout?: NightscoutConfig;
  t1care?: T1CareConfig;
}

// Data Source Adapter Interface
export interface IDataSourceAdapter {
  // Initialize with config
  initialize(config: any): Promise<void>;

  // Fetch glucose entries
  getGlucoseEntries(count?: number): Promise<GlucoseEntry[]>;

  // Fetch glucose entries by date range
  getGlucoseEntriesByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<GlucoseEntry[]>;

  // Fetch treatments
  getTreatments(
    count?: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TreatmentEntry[]>;

  // Fetch treatments by specific event type
  getTreatmentsByEventType(
    eventType: string,
    count?: number,
  ): Promise<TreatmentEntry[]>;

  // Get current glucose value
  getCurrentGlucose(): Promise<GlucoseEntry | null>;

  // Get device status
  getDeviceStatus(): Promise<DeviceStatus | null>;

  // Get profile data
  getProfile(): Promise<Profile | null>;

  // Create treatment
  createTreatment(treatment: Partial<TreatmentEntry>): Promise<TreatmentEntry>;

  // Check if configured
  isConfigured(): boolean;
}
