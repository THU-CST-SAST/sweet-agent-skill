import axios from 'axios';
import { currentContext } from '../runtime/context';
const Platform = { OS: 'node' };
const AGENT_SIMULATION_API_URL = '';
import type { DeviceStatus, GlucoseEntry, Profile, TreatmentEntry } from '../types';
import type { DecisionEvidenceBundle } from './decisionEvidence';
import { buildEmbeddedOnlineInput } from './loopinsightKernel/onlineInput';
import {
  runEmbeddedLoopInsightSimulation,
  type DecisionEvidenceContext,
  type OnlineInput,
} from './loopinsightKernel/onlineRuntime';

export type SimulationAction = {
  id: 'plan_a' | 'plan_b';
  kind: 'observe_and_recheck' | 'correction_bolus' | 'carb_rescue';
  insulinU: number;
  carbsG: number;
  recheckMinutes: number;
  blockers: string[];
};

export type SimulationPoint = {
  minutes: number;
  glucoseMgdl: number;
};

export type SimulationMetrics = {
  meanMgdl: number;
  minMgdl: number;
  minAtMinutes: number;
  maxMgdl: number;
  endMgdl: number;
  glucoseAt30Min: number;
  glucoseAt60Min: number;
  glucoseAt120Min: number;
  tirPercent: number;
  tbrPercent: number;
  tarPercent: number;
  points: SimulationPoint[];
};

export type SimulationCandidate = {
  action: SimulationAction;
  initialAction: SimulationAction;
  metrics: SimulationMetrics;
  validation: { passed: boolean; reasons: string[] };
  comparisonWarnings: string[];
  replanned: boolean;
  replanAttempts: Array<{
    iteration: number;
    action: SimulationAction;
    metrics: SimulationMetrics;
    reasons: string[];
  }>;
  score: number;
};

export type IntegratedSimulationResult = {
  schemaVersion: 'online-patient-planning-loop-v1';
  generatedAt: string;
  mode: 'simulation_only';
  executableOnRealDevice: false;
  source: {
    kind: 'app_data_snapshot' | 'nightscout_read_only';
    urlHost: string;
    asOf: string;
    counts: { glucose: number; treatments: number };
    observedGlucose: SimulationPoint[];
  };
  state: {
    currentGlucoseMgdl: number;
    slope30MinMgdlPerMin: number | null;
    iobU: number | null;
    cobG: number | null;
    blockers: string[];
  };
  patientInitialization: {
    warmupHours: number;
    historyReplayUsed: false;
    onlinePatientUsed: true;
    fixedReferencePatientUsed: false;
    currentState: {
      glucoseMgdl: number;
      slope30MinMgdlPerMin: number | null;
      iobU: number | null;
      cobG: number | null;
      patientState: Record<string, number>;
    };
    limitations: string[];
  };
  evidence: {
    schemaVersion: 'decision-evidence-v1';
    queryCount: number;
    approvedCount: number;
    coverage: DecisionEvidenceBundle['coverage'];
    missingTopics: string[];
    sourceRefs: string[];
    communityPolicy: 'pending_zsxq_not_eligible_for_action';
    received: true;
  };
  plan: {
    candidateCount: 2;
    candidates: [SimulationCandidate, SimulationCandidate];
    maxReplanIterations: number;
    selectionRule: string;
  };
  finalAction: {
    status:
      | 'requires_human_review'
      | 'blocked_no_safe_candidate';
    selectedPlanId: 'plan_a' | 'plan_b' | null;
    action: SimulationAction | null;
    predicted?: SimulationMetrics;
    warnings: string[];
    executable: false;
    destination: 'human_review_only';
    notice: string;
  };
  trace: Array<{ step: string; status: string; detail: string }>;
};

type SimulationRequest = {
  asOf: string;
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile;
  deviceStatus: DeviceStatus | null;
  approvedHypoCarbsG: number | null;
  decisionEvidence: IntegratedSimulationResult['evidence'];
};

export async function runIntegratedSimulation(input: {
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile | null;
  deviceStatus: DeviceStatus | null;
  approvedHypoCarbsG: number | null;
  evidence: DecisionEvidenceBundle;
}): Promise<IntegratedSimulationResult> {
  if (!input.entries.length) throw new Error('没有可用于仿真的血糖数据');
  if (!input.profile) throw new Error('缺少患者 Profile，无法初始化仿真');
  const request = buildSimulationRequest({
    ...input,
    profile: input.profile,
  });
  const configured = (AGENT_SIMULATION_API_URL || '').trim();
  if (!configured) {
    const result = runEmbeddedSimulation(request);
    try { currentContext().simulation = result; } catch { /* Direct numerical API has no workflow context. */ }
    return result;
  }
  const endpoint = `${simulationApiBaseUrl()}/v1/agent/simulate`;
  try {
    const response = await axios.post<IntegratedSimulationResult>(
      endpoint,
      request,
      {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
      },
    );
    validateSimulationResult(response.data);
    return response.data;
  } catch {
    return runEmbeddedSimulation(request, ['external_simulation_service_unavailable']);
  }
}

export function createSyntheticSimulationInput(): {
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile;
  deviceStatus: DeviceStatus;
  approvedHypoCarbsG: number;
} {
  const asOf = new Date();
  const entries: GlucoseEntry[] = Array.from({ length: 73 }, (_, index) => {
    const date = asOf.getTime() - (72 - index) * 5 * 60_000;
    const sgv = Math.round(108 + Math.sin(index / 8) * 4);
    return {
      _id: `synthetic-${index}`,
      sgv,
      date,
      dateString: new Date(date).toISOString(),
      trend: 4,
      direction: 'Flat',
      device: 'SweetOnline synthetic demo',
      type: 'sgv',
    };
  });
  const schedule = (value: number) => [{ time: '00:00', timeAsSeconds: 0, value }];
  const profile = {
    _id: 'synthetic-profile',
    defaultProfile: 'Default',
    store: {
      Default: {
        basal: schedule(0.5),
        sens: schedule(50),
        carbratio: schedule(12),
        target_low: schedule(90),
        target_high: schedule(110),
        timezone: 'Asia/Shanghai',
        units: 'mg/dL',
        dia: 5,
        carbs_hr: '20',
        delay: '20',
      },
    },
    startDate: asOf.toISOString(),
    mills: asOf.getTime(),
    units: 'mg/dL',
    enteredBy: 'SweetOnline synthetic demo',
  } satisfies Profile;
  const deviceStatus = {
    _id: 'synthetic-status',
    created_at: asOf.toISOString(),
    device: 'SweetOnline synthetic demo',
    mills: asOf.getTime(),
    loop: {
      name: 'Synthetic Loop',
      iob: { iob: 0, timestamp: asOf.toISOString() },
      cob: { cob: 0, timestamp: asOf.toISOString() },
      enacted: {
        received: true,
        duration: 0,
        timestamp: asOf.toISOString(),
        bolusVolume: 0,
        rate: 0.5,
      },
      timestamp: asOf.toISOString(),
      version: 'demo',
    },
    pump: { suspended: false },
  } satisfies DeviceStatus;
  return {
    entries,
    treatments: [],
    profile,
    deviceStatus,
    approvedHypoCarbsG: 15,
  };
}

export function simulationApiBaseUrl(): string {
  const configured = (AGENT_SIMULATION_API_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:8787'
    : 'http://127.0.0.1:8787';
}

export function buildSimulationNarrative(result: IntegratedSimulationResult): string {
  const current = result.state.currentGlucoseMgdl;
  const slope = result.state.slope30MinMgdlPerMin;
  const final = result.finalAction;
  const stateLine = `当前血糖 ${current} mg/dL，30 分钟斜率 ${slope ?? '缺失'} mg/dL/min，IOB ${result.state.iobU ?? '缺失'} U，COB ${result.state.cobG ?? '缺失'} g。`;
  if (!final.action) {
    const warnings = final.warnings.map(warningLabel).join('、') || '没有安全候选';
    return [
      stateLine,
      `结论：本轮不输出数值治疗建议。原因是${warnings}。`,
      '下一步：保持现有安全方案，补全缺失数据或复测后重新运行；若有明显不适、严重低血糖或酮体风险，请按既有急救/生病日方案处理。',
    ].join('\n\n');
  }
  const prediction = final.predicted;
  const action = actionNarrative(final.action);
  return [
    stateLine,
    `建议候选：${action}`,
    prediction
      ? `LoopInsighT1 预测：30 分钟 ${prediction.glucoseAt30Min}、60 分钟 ${prediction.glucoseAt60Min}、120 分钟 ${prediction.glucoseAt120Min} mg/dL；最低 ${prediction.minMgdl} mg/dL，TIR ${prediction.tirPercent}%。`
      : '',
    '该建议已通过本轮数据和仿真门禁，但仍只供人工审核，App 不会自动写入泵或 Nightscout。',
  ].filter(Boolean).join('\n\n');
}

function buildSimulationRequest(input: {
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile: Profile;
  deviceStatus: DeviceStatus | null;
  approvedHypoCarbsG: number | null;
  evidence: DecisionEvidenceBundle;
}): SimulationRequest {
  return {
    asOf: latestEntryTime(input.entries),
    entries: input.entries,
    treatments: input.treatments,
    profile: input.profile,
    deviceStatus: input.deviceStatus,
    approvedHypoCarbsG: input.approvedHypoCarbsG,
    decisionEvidence: {
      schemaVersion: input.evidence.schemaVersion,
      queryCount: input.evidence.queries.length,
      approvedCount: input.evidence.approved.length,
      coverage: input.evidence.coverage,
      missingTopics: input.evidence.missingTopics,
      sourceRefs: input.evidence.approved.map(source => source.sourceRef),
      communityPolicy: input.evidence.communityPolicy,
      received: true,
    },
  };
}

function runEmbeddedSimulation(
  request: SimulationRequest,
  serviceWarnings: string[] = [],
): IntegratedSimulationResult {
  const result = runEmbeddedLoopInsightSimulation({
    input: buildEmbeddedOnlineInput(request) as unknown as OnlineInput,
    approvedHypoCarbsG: request.approvedHypoCarbsG,
    decisionEvidence: decisionEvidenceForKernel(request.decisionEvidence),
  }) as unknown as IntegratedSimulationResult;
  return appendEmbeddedWarnings(result, serviceWarnings);
}

function decisionEvidenceForKernel(evidence: IntegratedSimulationResult['evidence']): DecisionEvidenceContext {
  return {
    schemaVersion: evidence.schemaVersion,
    queryCount: evidence.queryCount,
    approvedCount: evidence.approvedCount,
    coverage: evidence.coverage,
    missingTopics: evidence.missingTopics,
    sourceRefs: evidence.sourceRefs,
    communityPolicy: evidence.communityPolicy,
  };
}

function appendEmbeddedWarnings(
  result: IntegratedSimulationResult,
  serviceWarnings: string[],
): IntegratedSimulationResult {
  if (!serviceWarnings.length) return result;
  return {
    ...result,
    patientInitialization: {
      ...result.patientInitialization,
      limitations: compact([
        ...result.patientInitialization.limitations,
        '外部 LoopInsighT1 服务不可达，本轮使用 App 内置 LoopInsighT1 kernel。',
      ]),
    },
    finalAction: {
      ...result.finalAction,
      warnings: compact([...result.finalAction.warnings, ...serviceWarnings]),
    },
  };
}


function latestEntryTime(entries: GlucoseEntry[]): string {
  const latest = Math.max(...entries.map(entry =>
    Number(entry.date) || Date.parse(entry.dateString),
  ).filter(Number.isFinite));
  if (!Number.isFinite(latest)) throw new Error('血糖数据没有有效时间戳');
  return new Date(latest).toISOString();
}

function validateSimulationResult(result: IntegratedSimulationResult) {
  if (
    result.schemaVersion !== 'online-patient-planning-loop-v1'
    || result.mode !== 'simulation_only'
    || result.executableOnRealDevice !== false
    || result.patientInitialization.onlinePatientUsed !== true
    || result.patientInitialization.fixedReferencePatientUsed !== false
    || result.evidence?.received !== true
    || result.evidence.communityPolicy !== 'pending_zsxq_not_eligible_for_action'
    || result.finalAction.executable !== false
    || result.finalAction.destination !== 'human_review_only'
    || result.plan.candidates.length !== 2
  ) {
    throw new Error('仿真服务返回结果未通过 App 隔离校验');
  }
  if (result.finalAction.selectedPlanId && !result.finalAction.action) {
    throw new Error('仿真服务选择了 Plan，但没有返回 Action');
  }
}

function actionNarrative(action: SimulationAction): string {
  if (action.kind === 'correction_bolus') {
    return `考虑追加 ${action.insulinU} U 纠正胰岛素，并在 ${action.recheckMinutes} 分钟后复测。`;
  }
  if (action.kind === 'carb_rescue') {
    return `按患者已批准方案补充 ${action.carbsG} g 快速碳水，并在 ${action.recheckMinutes} 分钟后复测。`;
  }
  return `暂不新增治疗动作，在 ${action.recheckMinutes} 分钟后复测。`;
}

function warningLabel(value: string): string {
  const labels: Record<string, string> = {
    predicted_below_70: '预测会低于 70 mg/dL',
    predicted_tbr_above_limit: '预测低血糖暴露过多',
    predicted_above_250: '预测会高于 250 mg/dL',
    forecast_end_below_70: '仿真终点过低',
    forecast_end_above_180: '仿真终点仍偏高',
    approved_hypo_protocol_missing: '缺少患者已批准的低血糖方案',
    low_glucose_requires_active_protocol: '低血糖场景不能选择零动作',
    recent_glucose_history_insufficient: '近期 CGM 数据不足',
    iob_missing: 'IOB 缺失',
    cob_missing: 'COB 缺失',
    pump_suspended: '泵处于暂停状态',
  };
  return labels[value] ?? value;
}

function compact<T>(values: Array<T | false | null | undefined>): T[] {
  return values.filter(Boolean) as T[];
}
