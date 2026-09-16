import type {
  DeviceStatus,
  GlucoseEntry,
  Profile,
  ProfileStore,
  TreatmentEntry,
} from '../types';
import {
  detectDeviceType,
  getBasalRate,
  getCOBValue,
  getIOBValue,
  getLoopTimestamp,
  getPredictedBG,
} from '../utils/deviceStatusUtils';
import { buildAgentState } from './stateBuilder';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface PatientMetadata {
  ageYears?: number;
  weightKg?: number;
  /** Carbohydrate amount from this patient's clinician-approved hypo protocol. */
  approvedHypoCarbsG?: number;
}

export interface PatientDecisionStateInput {
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile | null;
  deviceStatus: DeviceStatus | null;
  asOf?: Date;
  patient?: PatientMetadata;
}

export type DecisionActionKind =
  | 'observe_and_recheck'
  | 'carb_rescue'
  | 'correction_bolus';

export interface ActionEligibility {
  allowedToCalculateNumericAmount: boolean;
  blockers: string[];
  requiresHumanReview: true;
}

export interface PatientDecisionState {
  schemaVersion: 'patient-decision-state-v1';
  asOf: string;
  source: {
    glucose: 'nightscout_or_app';
    treatments: 'nightscout_or_app';
    profile: 'nightscout_or_app' | 'missing';
    deviceStatus: 'nightscout_or_app' | 'missing';
  };
  patientContext: {
    ageYears: number | null;
    weightKg: number | null;
    approvedHypoCarbsG: number | null;
  };
  glucose: ReturnType<typeof buildAgentState>['glucose'] & {
    delta5MinMgdl: number | null;
    delta15MinMgdl: number | null;
    delta30MinMgdl: number | null;
    areaBelow70MgdlMin: number;
    areaAbove180MgdlMin: number;
    readings2h: number;
    readings6h: number;
    readings24h: number;
  };
  insulin: {
    iobU: number | null;
    iobAt: string | null;
    iobAgeMin: number | null;
    activityUPerMin: number | null;
    basalIobU: number | null;
    bolus2hU: number;
    bolus4hU: number;
    bolus24hU: number;
    basalDelivered24hU: number | null;
    lastBolusAt: string | null;
    minutesSinceLastBolus: number | null;
    scheduledBasalUph: number | null;
    activeBasalUph: number | null;
    pumpSuspended: boolean | null;
  };
  carbs: {
    cobG: number | null;
    cobAt: string | null;
    cobAgeMin: number | null;
    carbs2hG: number;
    carbs4hG: number;
    carbs24hG: number;
    lastCarbsAt: string | null;
    minutesSinceLastCarbs: number | null;
    treatmentHistoryPresent: boolean;
  };
  therapyProfile: {
    profileName: string | null;
    timezone: string | null;
    units: string | null;
    diaHours: number | null;
    activeBasalUph: number | null;
    activeIsfMgdlPerU: number | null;
    activeCarbRatioGPerU: number | null;
    targetLowMgdl: number | null;
    targetHighMgdl: number | null;
  };
  algorithm: {
    deviceType: ReturnType<typeof detectDeviceType>;
    statusAt: string | null;
    statusAgeMin: number | null;
    eventualBgMgdl: number | null;
    predictedBgMgdl: number[];
  };
  dataQuality: ReturnType<typeof buildAgentState>['dataQuality'] & {
    profileComplete: boolean;
    iobFresh: boolean;
    cobFresh: boolean;
    statusFresh: boolean;
    missingOrStale: string[];
  };
  riskFlags: string[];
  actionEligibility: Record<DecisionActionKind, ActionEligibility>;
}

/**
 * Builds the complete, deterministic decision input. It never guesses IOB, COB,
 * carbs, demographics or therapy settings when the source data is absent.
 */
export function buildPatientDecisionState(
  input: PatientDecisionStateInput,
): PatientDecisionState {
  const asOf = input.asOf ?? inferAsOf(input.entries) ?? new Date();
  const windowStart = new Date(asOf.getTime() - 24 * HOUR);
  const base = buildAgentState({
    route: 'current_state',
    entries: input.entries,
    treatments: input.treatments,
    now: asOf,
    rangeStart: windowStart,
    rangeEnd: asOf,
  });
  const profileStore = resolveProfileStore(input.profile);
  const statusAt = getLoopTimestamp(input.deviceStatus);
  const statusAgeMin = ageMinutes(statusAt, asOf);
  const iobAt = resolveIobTimestamp(input.deviceStatus);
  const cobAt = resolveCobTimestamp(input.deviceStatus);
  const iobAgeMin = ageMinutes(iobAt, asOf);
  const cobAgeMin = ageMinutes(cobAt, asOf);
  const iobFresh = getIOBValue(input.deviceStatus) !== null && isFresh(iobAgeMin, 15);
  const cobFresh = getCOBValue(input.deviceStatus) !== null && isFresh(cobAgeMin, 15);
  const statusFresh = isFresh(statusAgeMin, 15);
  const profileSnapshot = buildProfileSnapshot(input.profile, profileStore, asOf);
  const glucosePoints = normalizeGlucose(input.entries, windowStart, asOf);
  const recentGlucoseComplete = hasContinuousRecentGlucose(glucosePoints, asOf);
  const treatments = normalizeTreatments(input.treatments, windowStart, asOf);
  const boluses = treatments.filter(item => positive(item.insulin));
  const carbEntries = treatments.filter(item => positive(item.carbs));
  const currentAt = base.glucose.currentAt;
  const currentAgeMin = ageMinutes(currentAt, asOf);
  const missingOrStale: string[] = [];

  if (base.dataQuality.status === 'insufficient') missingOrStale.push('glucose_history_insufficient');
  if (!isFresh(currentAgeMin, 15)) missingOrStale.push('current_glucose_missing_or_stale');
  if (!profileComplete(profileSnapshot)) missingOrStale.push('therapy_profile_incomplete');
  if (!iobFresh) missingOrStale.push('iob_missing_or_stale');
  if (!cobFresh) missingOrStale.push('cob_missing_or_stale');
  if (!statusFresh) missingOrStale.push('algorithm_status_missing_or_stale');
  if (!carbEntries.length) missingOrStale.push('carb_treatment_history_missing');

  const pumpSuspended = input.deviceStatus?.pump?.suspended ?? null;
  const riskFlags = [...base.riskFlags];
  if (pumpSuspended) riskFlags.push('pump_suspended');
  if ((getIOBValue(input.deviceStatus) ?? 0) > 0 && (base.glucose.slope30Min ?? 0) < 0) {
    riskFlags.push('active_insulin_with_falling_glucose');
  }
  const eventual = input.deviceStatus?.openaps?.suggested?.eventualBG ?? null;
  if (eventual !== null && eventual < 70) riskFlags.push('algorithm_projected_low');

  const commonNumericBlockers = compact([
    !isFresh(currentAgeMin, 15) && 'current_glucose_missing_or_stale',
    !recentGlucoseComplete && 'recent_glucose_history_insufficient',
    !statusFresh && 'algorithm_status_missing_or_stale',
  ]);
  const correctionBlockers = compact([
    ...commonNumericBlockers,
    !profileComplete(profileSnapshot) && 'therapy_profile_incomplete',
    !iobFresh && 'iob_missing_or_stale',
    !cobFresh && 'cob_missing_or_stale',
    pumpSuspended === true && 'pump_suspended',
    base.glucose.currentMgdl !== null
      && base.glucose.currentMgdl <= (profileSnapshot.targetHighMgdl ?? 180)
      && 'glucose_not_above_correction_target',
  ]);
  const rescueProtocolKnown = positive(input.patient?.approvedHypoCarbsG);
  const rescueBlockers = compact([
    ...commonNumericBlockers,
    !rescueProtocolKnown && 'patient_specific_hypoglycemia_protocol_missing',
    base.glucose.currentMgdl !== null
      && base.glucose.currentMgdl >= 70
      && 'glucose_not_low',
  ]);

  return {
    schemaVersion: 'patient-decision-state-v1',
    asOf: asOf.toISOString(),
    source: {
      glucose: 'nightscout_or_app',
      treatments: 'nightscout_or_app',
      profile: input.profile ? 'nightscout_or_app' : 'missing',
      deviceStatus: input.deviceStatus ? 'nightscout_or_app' : 'missing',
    },
    patientContext: {
      ageYears: nullableNumber(input.patient?.ageYears),
      weightKg: nullableNumber(input.patient?.weightKg),
      approvedHypoCarbsG: nullableNumber(input.patient?.approvedHypoCarbsG),
    },
    glucose: {
      ...base.glucose,
      delta5MinMgdl: deltaFrom(glucosePoints, asOf, 5),
      delta15MinMgdl: deltaFrom(glucosePoints, asOf, 15),
      delta30MinMgdl: deltaFrom(glucosePoints, asOf, 30),
      areaBelow70MgdlMin: areaOutsideRange(glucosePoints, 70, 'below'),
      areaAbove180MgdlMin: areaOutsideRange(glucosePoints, 180, 'above'),
      readings2h: countSince(glucosePoints, asOf, 2 * HOUR),
      readings6h: countSince(glucosePoints, asOf, 6 * HOUR),
      readings24h: glucosePoints.length,
    },
    insulin: {
      iobU: nullableNumber(getIOBValue(input.deviceStatus)),
      iobAt,
      iobAgeMin,
      activityUPerMin: nullableNumber(input.deviceStatus?.openaps?.iob?.activity),
      basalIobU: nullableNumber(input.deviceStatus?.openaps?.iob?.basaliob),
      bolus2hU: sumRecent(boluses, asOf, 2 * HOUR, 'insulin'),
      bolus4hU: sumRecent(boluses, asOf, 4 * HOUR, 'insulin'),
      bolus24hU: sumRecent(boluses, asOf, 24 * HOUR, 'insulin'),
      basalDelivered24hU: profileStore
        ? estimateBasalDelivered(profileStore, treatments, windowStart, asOf)
        : null,
      lastBolusAt: base.treatments.lastBolusAt,
      minutesSinceLastBolus: base.treatments.minutesSinceLastBolus,
      scheduledBasalUph: profileSnapshot.activeBasalUph,
      activeBasalUph: nullableNumber(getBasalRate(input.deviceStatus))
        ?? profileSnapshot.activeBasalUph,
      pumpSuspended,
    },
    carbs: {
      cobG: nullableNumber(getCOBValue(input.deviceStatus)),
      cobAt,
      cobAgeMin,
      carbs2hG: sumRecent(carbEntries, asOf, 2 * HOUR, 'carbs'),
      carbs4hG: sumRecent(carbEntries, asOf, 4 * HOUR, 'carbs'),
      carbs24hG: sumRecent(carbEntries, asOf, 24 * HOUR, 'carbs'),
      lastCarbsAt: base.treatments.lastCarbsAt,
      minutesSinceLastCarbs: base.treatments.minutesSinceLastCarbs,
      treatmentHistoryPresent: carbEntries.length > 0,
    },
    therapyProfile: profileSnapshot,
    algorithm: {
      deviceType: detectDeviceType(input.deviceStatus),
      statusAt,
      statusAgeMin,
      eventualBgMgdl: nullableNumber(eventual),
      predictedBgMgdl: getPredictedBG(input.deviceStatus).filter(Number.isFinite),
    },
    dataQuality: {
      ...base.dataQuality,
      profileComplete: profileComplete(profileSnapshot),
      iobFresh,
      cobFresh,
      statusFresh,
      missingOrStale,
    },
    riskFlags: [...new Set(riskFlags)],
    actionEligibility: {
      observe_and_recheck: {
        allowedToCalculateNumericAmount: commonNumericBlockers.length === 0,
        blockers: commonNumericBlockers,
        requiresHumanReview: true,
      },
      carb_rescue: {
        allowedToCalculateNumericAmount: rescueBlockers.length === 0,
        blockers: rescueBlockers,
        requiresHumanReview: true,
      },
      correction_bolus: {
        allowedToCalculateNumericAmount: correctionBlockers.length === 0,
        blockers: correctionBlockers,
        requiresHumanReview: true,
      },
    },
  };
}

function inferAsOf(entries: GlucoseEntry[]): Date | null {
  const values = entries
    .map(entry => Number(entry.date) || Date.parse(entry.dateString))
    .filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)) : null;
}

function resolveProfileStore(profile: Profile | null): ProfileStore | null {
  if (!profile?.store) return null;
  const store = profile.store as unknown as Record<string, ProfileStore>;
  return store[profile.defaultProfile] ?? store.Default ?? Object.values(store)[0] ?? null;
}

function buildProfileSnapshot(
  profile: Profile | null,
  store: ProfileStore | null,
  asOf: Date,
): PatientDecisionState['therapyProfile'] {
  if (!store) {
    return {
      profileName: null,
      timezone: null,
      units: null,
      diaHours: null,
      activeBasalUph: null,
      activeIsfMgdlPerU: null,
      activeCarbRatioGPerU: null,
      targetLowMgdl: null,
      targetHighMgdl: null,
    };
  }
  const seconds = secondsFromMidnight(asOf, store.timezone);
  const units = store.units || profile?.units || null;
  const normalizeGlucoseUnit = (value: number | null) =>
    usesMmol(units) && value !== null ? round(value * 18, 0) : value;
  return {
    profileName: profile?.defaultProfile ?? null,
    timezone: store.timezone || null,
    units,
    diaHours: finiteOrNull(store.dia),
    activeBasalUph: scheduleValue(store.basal, seconds),
    activeIsfMgdlPerU: normalizeGlucoseUnit(scheduleValue(store.sens, seconds)),
    activeCarbRatioGPerU: scheduleValue(store.carbratio, seconds),
    targetLowMgdl: normalizeGlucoseUnit(scheduleValue(store.target_low, seconds)),
    targetHighMgdl: normalizeGlucoseUnit(scheduleValue(store.target_high, seconds)),
  };
}

function usesMmol(units: string | null): boolean {
  return /mmol/i.test(units ?? '');
}

function profileComplete(profile: PatientDecisionState['therapyProfile']): boolean {
  return profile.diaHours !== null
    && profile.diaHours > 0
    && profile.activeBasalUph !== null
    && profile.activeIsfMgdlPerU !== null
    && profile.activeIsfMgdlPerU > 0
    && profile.activeCarbRatioGPerU !== null
    && profile.activeCarbRatioGPerU > 0
    && profile.targetLowMgdl !== null
    && profile.targetHighMgdl !== null;
}

function secondsFromMidnight(date: Date, timezone?: string): number {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date);
      const value = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find(part => part.type === type)?.value ?? 0);
      return value('hour') * 3600 + value('minute') * 60 + value('second');
    } catch {
      // Some Android JS runtimes do not ship every IANA zone. Use device time,
      // while retaining the timezone and an incomplete-status signal upstream.
    }
  }
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function scheduleValue(
  entries: Array<{ value: number; timeAsSeconds: number }> | undefined,
  seconds: number,
): number | null {
  if (!entries?.length) return null;
  const sorted = [...entries].sort((a, b) => a.timeAsSeconds - b.timeAsSeconds);
  let active = sorted.at(-1)!;
  for (const entry of sorted) {
    if (seconds >= entry.timeAsSeconds) active = entry;
    else break;
  }
  return finiteOrNull(active.value);
}

type GlucosePoint = { time: number; value: number };

function normalizeGlucose(entries: GlucoseEntry[], start: Date, end: Date): GlucosePoint[] {
  const points = new Map<number, GlucosePoint>();
  for (const entry of entries) {
    const time = Number(entry.date) || Date.parse(entry.dateString);
    const value = Number(entry.sgv);
    if (Number.isFinite(time) && Number.isFinite(value) && time >= start.getTime()
      && time <= end.getTime() && value >= 20 && value <= 600) {
      points.set(time, { time, value });
    }
  }
  return [...points.values()].sort((a, b) => a.time - b.time);
}

function normalizeTreatments(
  treatments: TreatmentEntry[],
  start: Date,
  end: Date,
): TreatmentEntry[] {
  return treatments.filter(item => {
    const time = treatmentTime(item);
    return time !== null && time >= start.getTime() && time <= end.getTime();
  });
}

function treatmentTime(item: TreatmentEntry): number | null {
  const time = Date.parse(item.created_at || item.timestamp);
  return Number.isFinite(time) ? time : null;
}

function deltaFrom(points: GlucosePoint[], asOf: Date, minutes: number): number | null {
  const current = points.at(-1);
  if (!current) return null;
  const target = asOf.getTime() - minutes * MINUTE;
  const previous = nearest(points, target, 4 * MINUTE);
  return previous ? round(current.value - previous.value, 1) : null;
}

function nearest(points: GlucosePoint[], target: number, tolerance: number): GlucosePoint | null {
  let winner: GlucosePoint | null = null;
  let distance = Infinity;
  for (const point of points) {
    const candidateDistance = Math.abs(point.time - target);
    if (candidateDistance < distance && candidateDistance <= tolerance) {
      winner = point;
      distance = candidateDistance;
    }
  }
  return winner;
}

function areaOutsideRange(
  points: GlucosePoint[],
  threshold: number,
  side: 'below' | 'above',
): number {
  let area = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const minutes = Math.min(30, (right.time - left.time) / MINUTE);
    if (minutes <= 0) continue;
    const leftDistance = side === 'below'
      ? Math.max(0, threshold - left.value)
      : Math.max(0, left.value - threshold);
    const rightDistance = side === 'below'
      ? Math.max(0, threshold - right.value)
      : Math.max(0, right.value - threshold);
    area += ((leftDistance + rightDistance) / 2) * minutes;
  }
  return round(area, 1);
}

function countSince(points: GlucosePoint[], asOf: Date, duration: number): number {
  const cutoff = asOf.getTime() - duration;
  return points.filter(point => point.time >= cutoff).length;
}

function hasContinuousRecentGlucose(points: GlucosePoint[], asOf: Date): boolean {
  const cutoff = asOf.getTime() - 2 * HOUR;
  const recent = points.filter(point => point.time >= cutoff);
  if (recent.length < 18) return false;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].time - recent[index - 1].time > 15 * MINUTE) return false;
  }
  return true;
}

function sumRecent(
  entries: TreatmentEntry[],
  asOf: Date,
  duration: number,
  field: 'insulin' | 'carbs',
): number {
  const cutoff = asOf.getTime() - duration;
  return round(entries.reduce((sum, entry) => {
    const time = treatmentTime(entry);
    return time !== null && time >= cutoff ? sum + Number(entry[field] ?? 0) : sum;
  }, 0), field === 'insulin' ? 2 : 1);
}

function estimateBasalDelivered(
  profile: ProfileStore,
  treatments: TreatmentEntry[],
  start: Date,
  end: Date,
): number {
  const tempBasals = treatments
    .filter(item => item.eventType === 'Temp Basal' && treatmentTime(item) !== null)
    .map(item => ({
      start: treatmentTime(item)!,
      end: treatmentTime(item)! + Math.max(0, Number(item.duration ?? 0)) * MINUTE,
      rate: Number(item.absolute ?? item.rate),
    }))
    .filter(item => Number.isFinite(item.rate));
  let delivered = 0;
  for (let time = start.getTime(); time < end.getTime(); time += 5 * MINUTE) {
    const stepEnd = Math.min(end.getTime(), time + 5 * MINUTE);
    const midpoint = (time + stepEnd) / 2;
    const temp = [...tempBasals].reverse().find(item => item.start <= midpoint && item.end > midpoint);
    const rate = temp?.rate ?? scheduleValue(
      profile.basal,
      secondsFromMidnight(new Date(midpoint), profile.timezone),
    ) ?? 0;
    delivered += rate * ((stepEnd - time) / HOUR);
  }
  return round(delivered, 2);
}

function resolveIobTimestamp(status: DeviceStatus | null): string | null {
  return status?.loop?.iob?.timestamp
    ?? status?.openaps?.iob?.time
    ?? getLoopTimestamp(status);
}

function resolveCobTimestamp(status: DeviceStatus | null): string | null {
  return status?.loop?.cob?.timestamp
    ?? status?.openaps?.suggested?.timestamp
    ?? getLoopTimestamp(status);
}

function ageMinutes(value: string | null, asOf: Date): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return round(Math.max(0, (asOf.getTime() - timestamp) / MINUTE), 1);
}

function isFresh(age: number | null, maxMinutes: number): boolean {
  return age !== null && age <= maxMinutes;
}

function positive(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return finiteOrNull(Number(value));
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(values: Array<string | false | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function round(value: number, digits = 0): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}
