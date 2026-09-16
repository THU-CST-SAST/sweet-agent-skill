import type { GlucoseEntry, TreatmentEntry } from '../types';
import type {
  AgentDataQuality,
  AgentStateInput,
  AgentStateSnapshot,
  GlucoseTrend,
} from './types';

const MIN_VALID_GLUCOSE = 20;
const MAX_VALID_GLUCOSE = 600;
const EXPECTED_INTERVAL_MIN = 5;

type Point = { time: number; value: number };

export function buildAgentState(input: AgentStateInput): AgentStateSnapshot {
  const now = input.now ?? new Date();
  const end = input.rangeEnd ?? now;
  const start = input.rangeStart ?? defaultRangeStart(input.route, end);
  const points = normalizeEntries(input.entries, start, end);
  const treatments = normalizeTreatments(input.treatments, start, end);
  const latest = points.at(-1) ?? null;
  const slope15 = regressionSlope(recentPoints(points, end, 15));
  const trendPoints = recentPoints(points, end, 30);
  const slope30 = regressionSlope(trendPoints);
  const slope60 = regressionSlope(recentPoints(points, end, 60));
  const values = points.map(point => point.value);
  const mean = average(values);
  const stdDev = standardDeviation(values, mean);
  const quality = buildDataQuality(points, start, end, now);
  const treatmentFeatures = summarizeTreatments(treatments, now);
  const trend = classifyTrend(slope30);
  const projected30 = latest && slope30 !== null
    ? round(latest.value + slope30 * 30, 1)
    : null;

  const glucose = {
    currentMgdl: latest?.value ?? null,
    currentAt: latest ? new Date(latest.time).toISOString() : null,
    slope15Min: nullableRound(slope15, 2),
    slope30Min: nullableRound(slope30, 2),
    slope60Min: nullableRound(slope60, 2),
    trend,
    trendMethod: 'linear_regression_30m' as const,
    trendSampleCount: trendPoints.length,
    projected30MinMgdl: projected30,
    meanMgdl: nullableRound(mean, 1),
    standardDeviationMgdl: nullableRound(stdDev, 1),
    cvPercent:
      mean !== null && mean > 0 && stdDev !== null
        ? round((stdDev / mean) * 100, 1)
        : null,
    minMgdl: values.length ? Math.min(...values) : null,
    maxMgdl: values.length ? Math.max(...values) : null,
    tirPercent: rangePercent(values, value => value >= 70 && value <= 180),
    tbrPercent: rangePercent(values, value => value < 70),
    tarPercent: rangePercent(values, value => value > 180),
  };

  const riskFlags: string[] = [];
  if (quality.status !== 'good') riskFlags.push('data_quality_not_good');
  if ((glucose.currentMgdl ?? Infinity) < 70) riskFlags.push('low_glucose');
  if ((glucose.currentMgdl ?? 0) > 250) riskFlags.push('very_high_glucose');
  if ((glucose.slope30Min ?? 0) <= -2) riskFlags.push('rapid_fall');
  if ((glucose.slope30Min ?? 0) >= 2) riskFlags.push('rapid_rise');
  if ((glucose.projected30MinMgdl ?? Infinity) < 70) {
    riskFlags.push('projected_low_30m');
  }

  return {
    schemaVersion: 'agent-state-v1',
    route: input.route,
    builtAt: now.toISOString(),
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      durationHours: round((end.getTime() - start.getTime()) / 36e5, 1),
    },
    glucose,
    treatments: treatmentFeatures,
    dataQuality: quality,
    riskFlags,
    sourceCounts: {
      glucose: points.length,
      treatments: treatments.length,
    },
  };
}

function defaultRangeStart(route: AgentStateInput['route'], end: Date): Date {
  if (route === 'weekly_report') {
    return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (route === 'daily_report') {
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(end.getTime() - 24 * 60 * 60 * 1000);
}

function normalizeEntries(entries: GlucoseEntry[], start: Date, end: Date): Point[] {
  const byTimestamp = new Map<number, Point>();
  for (const entry of entries) {
    const time = Number(entry.date) || Date.parse(entry.dateString);
    const value = Number(entry.sgv);
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(value) ||
      value < MIN_VALID_GLUCOSE ||
      value > MAX_VALID_GLUCOSE ||
      time < start.getTime() ||
      time > end.getTime()
    ) {
      continue;
    }
    byTimestamp.set(time, { time, value });
  }
  return [...byTimestamp.values()].sort((a, b) => a.time - b.time);
}

function normalizeTreatments(
  treatments: TreatmentEntry[],
  start: Date,
  end: Date,
): TreatmentEntry[] {
  return treatments.filter(treatment => {
    const timestamp = treatmentTimestamp(treatment);
    return timestamp !== null && timestamp >= start.getTime() && timestamp <= end.getTime();
  });
}

function treatmentTimestamp(treatment: TreatmentEntry): number | null {
  const timestamp = Date.parse(treatment.created_at || treatment.timestamp);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function recentPoints(points: Point[], end: Date, minutes: number): Point[] {
  const cutoff = end.getTime() - minutes * 60e3;
  return points.filter(point => point.time >= cutoff);
}

function regressionSlope(points: Point[]): number | null {
  if (points.length < 3) return null;
  const origin = points[0].time;
  const xs = points.map(point => (point.time - origin) / 60e3);
  const ys = points.map(point => point.value);
  const meanX = average(xs)!;
  const meanY = average(ys)!;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < points.length; index += 1) {
    numerator += (xs[index] - meanX) * (ys[index] - meanY);
    denominator += Math.pow(xs[index] - meanX, 2);
  }
  return denominator === 0 ? null : numerator / denominator;
}

export function classifyTrend(slope: number | null): GlucoseTrend {
  if (slope === null) return 'unknown';
  if (slope >= 2) return 'rapidly_rising';
  if (slope >= 1) return 'rising';
  if (slope >= 0.3) return 'gently_rising';
  if (slope > -0.3) return 'stable';
  if (slope > -1) return 'gently_falling';
  if (slope > -2) return 'falling';
  return 'rapidly_falling';
}

function buildDataQuality(
  points: Point[],
  start: Date,
  end: Date,
  now: Date,
): AgentDataQuality {
  const expected = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / (EXPECTED_INTERVAL_MIN * 60e3)) + 1,
  );
  const coverage = round(Math.min(100, (points.length / expected) * 100), 1);
  const latestAge = points.length
    ? Math.max(0, (now.getTime() - points.at(-1)!.time) / 60e3)
    : null;
  let maxGap: number | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const gap = (points[index].time - points[index - 1].time) / 60e3;
    maxGap = maxGap === null ? gap : Math.max(maxGap, gap);
  }
  const warnings: string[] = [];
  if (points.length < 3) warnings.push('有效血糖点不足，无法可靠计算趋势');
  if (coverage < 70) warnings.push(`时间窗数据覆盖率仅 ${coverage}%`);
  if (latestAge !== null && latestAge > 15) warnings.push('最新血糖数据已超过 15 分钟');
  if ((maxGap ?? 0) > 20) warnings.push(`存在最长 ${round(maxGap!, 0)} 分钟的数据中断`);
  const status = points.length < 3 || coverage < 30
    ? 'insufficient'
    : coverage < 70 || (latestAge ?? Infinity) > 15 || (maxGap ?? 0) > 20
      ? 'partial'
      : 'good';
  return {
    status,
    validReadings: points.length,
    expectedReadings: expected,
    coveragePercent: coverage,
    latestReadingAgeMin: nullableRound(latestAge, 1),
    maxGapMin: nullableRound(maxGap, 1),
    warnings,
  };
}

function summarizeTreatments(treatments: TreatmentEntry[], now: Date) {
  const boluses = treatments.filter(item => Number(item.insulin) > 0);
  const carbs = treatments.filter(item => Number(item.carbs) > 0);
  const lastBolusAt = latestTreatmentTime(boluses);
  const lastCarbsAt = latestTreatmentTime(carbs);
  return {
    bolusTotalU: round(boluses.reduce((sum, item) => sum + Number(item.insulin), 0), 2),
    carbsTotalG: round(carbs.reduce((sum, item) => sum + Number(item.carbs), 0), 1),
    bolusCount: boluses.length,
    carbCount: carbs.length,
    lastBolusAt: lastBolusAt ? new Date(lastBolusAt).toISOString() : null,
    minutesSinceLastBolus: lastBolusAt
      ? round(Math.max(0, (now.getTime() - lastBolusAt) / 60e3), 1)
      : null,
    lastCarbsAt: lastCarbsAt ? new Date(lastCarbsAt).toISOString() : null,
    minutesSinceLastCarbs: lastCarbsAt
      ? round(Math.max(0, (now.getTime() - lastCarbsAt) / 60e3), 1)
      : null,
  };
}

function latestTreatmentTime(items: TreatmentEntry[]): number | null {
  const values = items
    .map(treatmentTimestamp)
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[], mean: number | null): number | null {
  if (!values.length || mean === null) return null;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function rangePercent(values: number[], predicate: (value: number) => boolean): number | null {
  if (!values.length) return null;
  return round((values.filter(predicate).length / values.length) * 100, 1);
}

function nullableRound(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}

function round(value: number, digits = 0): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

