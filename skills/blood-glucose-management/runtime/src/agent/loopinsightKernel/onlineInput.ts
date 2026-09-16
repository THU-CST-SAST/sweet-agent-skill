import type { DeviceStatus, GlucoseEntry, Profile, ProfileStore, TreatmentEntry } from '../../types';

const HOUR_MS = 60 * 60_000;

export type EmbeddedSimulationPayload = {
  asOf: string;
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile;
  deviceStatus: DeviceStatus | null;
  approvedHypoCarbsG: number | null;
};

export type EmbeddedEntry = { sgv: number; date: number; dateString?: string };
export type EmbeddedTreatment = TreatmentEntry;

export type EmbeddedOnlineInput = {
  sourceUrl: string;
  sourceKind: 'app_data_snapshot';
  asOf: Date;
  entries: EmbeddedEntry[];
  treatments: EmbeddedTreatment[];
  profile: Profile;
  profileStore: ProfileStore;
  deviceStatus: DeviceStatus | null;
};

export function buildEmbeddedOnlineInput(payload: EmbeddedSimulationPayload): EmbeddedOnlineInput {
  if (!payload.entries.length) throw new Error('App payload is missing glucose entries.');
  if (!payload.profile?.store) throw new Error('App payload is missing a Nightscout profile.');
  const asOf = new Date(payload.asOf);
  if (!Number.isFinite(asOf.valueOf())) throw new Error('App payload has an invalid asOf timestamp.');
  const profileStore = activeProfileStore(payload.profile);
  if (!profileStore) throw new Error('App payload profile has no usable store.');
  const start = new Date(asOf.valueOf() - 24 * HOUR_MS);
  return {
    sourceUrl: 'https://embedded-loopinsight-kernel',
    sourceKind: 'app_data_snapshot',
    asOf,
    entries: normalizeEntries(payload.entries, start, asOf),
    treatments: normalizeTreatments(payload.treatments, start, asOf),
    profile: payload.profile,
    profileStore,
    deviceStatus: payload.deviceStatus,
  };
}

function activeProfileStore(profile: Profile): ProfileStore | null {
  const stores = profile.store as Record<string, ProfileStore> | undefined;
  if (!stores) return null;
  return stores[profile.defaultProfile ?? '']
    ?? stores.Default
    ?? Object.values(stores)[0]
    ?? null;
}

function normalizeEntries(entries: GlucoseEntry[], start: Date, end: Date): EmbeddedEntry[] {
  const unique = new Map<number, EmbeddedEntry>();
  entries.forEach(entry => {
    const date = Number(entry.date) || Date.parse(entry.dateString);
    const sgv = Number(entry.sgv);
    if (
      Number.isFinite(date)
      && Number.isFinite(sgv)
      && sgv >= 20
      && sgv <= 600
      && date >= start.valueOf()
      && date <= end.valueOf()
    ) {
      unique.set(date, { sgv, date, dateString: entry.dateString });
    }
  });
  return [...unique.values()].sort((a, b) => a.date - b.date);
}

function normalizeTreatments(treatments: TreatmentEntry[], start: Date, end: Date): EmbeddedTreatment[] {
  return treatments.filter(treatment => {
    const time = treatmentTime(treatment);
    return time !== null && time >= start.valueOf() && time <= end.valueOf();
  });
}

function treatmentTime(treatment: TreatmentEntry): number | null {
  const value = Date.parse(treatment.created_at ?? treatment.timestamp ?? '');
  return Number.isFinite(value) ? value : null;
}
