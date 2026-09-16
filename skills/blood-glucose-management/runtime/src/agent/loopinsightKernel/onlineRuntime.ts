import {
    AbstractController,
    IdealCGM,
    Simulator,
    StaticInsulinPump,
    VirtualPatientDeichmann,
    type AnnouncementList,
    type Controller,
    type ControllerOutput,
    type Meal,
    type Measurement,
    type ModuleProfile,
    type ParameterDescriptions,
    type PatientState,
    type TracedMeasurement,
} from '.'
import {
    refineAction,
    selectRecommendedCandidate,
    selectFinalAttempt,
    type CandidateAction,
    type ForecastAttempt,
} from './onlinePolicy'

const MINUTE = 60e3
const HOUR = 60 * MINUTE
const FORECAST_HOURS = 2
const MAX_ALLOWED_TBR_PERCENT = 5
const DEFAULT_HYPO_CARBS_G = 15

export type Entry = { sgv: number, date: number, dateString?: string }
export type Treatment = {
    eventType?: string
    created_at?: string
    timestamp?: string
    insulin?: number
    carbs?: number
    duration?: number
    durationInMilliseconds?: number
    absolute?: number
    rate?: number
    pumpId?: number
    endId?: number
    endmills?: number
}
export type ScheduleEntry = { time?: string, value: number, timeAsSeconds: number }
export type ProfileStore = {
    basal: ScheduleEntry[]
    sens: ScheduleEntry[]
    carbratio: ScheduleEntry[]
    target_low: ScheduleEntry[]
    target_high: ScheduleEntry[]
    timezone?: string
    dia?: number
    units?: string
}
export type Profile = { defaultProfile?: string, store?: Record<string, ProfileStore> }
export type DeviceStatus = {
    created_at?: string
    loop?: { iob?: { iob?: number, timestamp?: string }, cob?: { cob?: number, timestamp?: string } }
    openaps?: {
        iob?: { iob?: number, activity?: number, basaliob?: number, time?: string }
        suggested?: {
            COB?: number
            eventualBG?: number
            timestamp?: string
            rate?: number
            predBGs?: Record<string, number[] | undefined>
        }
    }
    pump?: { suspended?: boolean }
}

export type OnlineInput = {
    sourceUrl: string
    sourceKind: 'nightscout_read_only' | 'app_data_snapshot'
    asOf: Date
    entries: Entry[]
    treatments: Treatment[]
    profile: Profile
    profileStore: ProfileStore
    deviceStatus: DeviceStatus | null
}

export type ForecastPoint = {
    minutes: number
    glucoseMgdl: number
}

export type ForecastMetrics = {
    meanMgdl: number
    minMgdl: number
    minAtMinutes: number
    maxMgdl: number
    endMgdl: number
    glucoseAt30Min: number
    glucoseAt60Min: number
    glucoseAt120Min: number
    tirPercent: number
    tbrPercent: number
    tarPercent: number
    points: ForecastPoint[]
}

export type AppSimulationPayload = {
    sourceUrl?: string
    asOf?: string
    entries: Entry[]
    treatments: Treatment[]
    profile: Profile
    deviceStatus?: DeviceStatus | null
    approvedHypoCarbsG?: number | null
    decisionEvidence?: DecisionEvidenceContext
}

export type DecisionEvidenceContext = {
    schemaVersion: 'decision-evidence-v1'
    queryCount: number
    approvedCount: number
    coverage: {
        hypoglycemia: boolean
        falling_with_iob: boolean
        correction_bolus: boolean
        carb_insulin_matching: boolean
        data_uncertainty: boolean
    }
    missingTopics: string[]
    sourceRefs: string[]
    communityPolicy: 'pending_zsxq_not_eligible_for_action'
}

type CurrentStateInitialization = {
    patientState: PatientState
    parameters: { p1Multiplier: number, p3Multiplier: number }
}

export function runOnlinePatientLoop(
    input: OnlineInput,
    options: {
        approvedHypoCarbsG?: number | null
        decisionEvidence?: DecisionEvidenceContext
    } = {},
) {
    const state = buildDecisionInput(input)
    const initialization = initializeFromCurrentState(input, state)
    const evidence = normalizeDecisionEvidence(options.decisionEvidence)
    const candidates = applyEvidenceGate(
        createTwoCandidates(state, finiteOrNull(options.approvedHypoCarbsG)),
        evidence,
    )
    const simulated = candidates.map(candidate => simulateWithReplan(input, initialization, state, candidate))
    const counterfactuals = createCounterfactuals(input, initialization, state)
    const selected = selectRecommendedCandidate(simulated)
    const selectedPassed = Boolean(
        selected
        && selected.action.blockers.length === 0
        && selected.validation.passed,
    )
    const finalStatus = selectedPassed
        ? 'requires_human_review'
        : 'blocked_no_safe_candidate'
    const payload = {
        schemaVersion: 'online-patient-planning-loop-v1',
        generatedAt: new Date().toISOString(),
        mode: 'simulation_only',
        executableOnRealDevice: false,
        source: {
            kind: input.sourceKind,
            urlHost: sourceHost(input.sourceUrl),
            asOf: input.asOf.toISOString(),
            counts: { glucose: input.entries.length, treatments: input.treatments.length },
            observedGlucose: input.entries
                .filter(entry => entry.date >= input.asOf.valueOf() - 2 * HOUR)
                .map(entry => ({
                    minutes: round((entry.date - input.asOf.valueOf()) / MINUTE, 1),
                    glucoseMgdl: entry.sgv,
                })),
        },
        state,
        patientInitialization: {
            method: 'current_observation_state_initialization',
            model: 'Deichmann2021',
            warmupHours: 0,
            historyReplayUsed: false,
            mappedInputs: [
                'current CGM and 30-minute trend',
                'current scheduled or temporary basal',
                'current IOB',
                'current COB',
                'active therapy target',
            ],
            currentState: {
                glucoseMgdl: state.currentGlucoseMgdl,
                slope30MinMgdlPerMin: state.slope30MinMgdlPerMin,
                iobU: state.iobU,
                cobG: state.cobG,
                patientState: summarizeState(initialization.patientState),
            },
            onlinePatientUsed: true,
            fixedReferencePatientUsed: false,
            limitations: compact([
                options.approvedHypoCarbsG == null && `患者未配置专属低血糖补碳量；低血糖候选使用 ${DEFAULT_HYPO_CARBS_G} g 默认仿真值。`,
                state.iobU === null && '实时 IOB 缺失；候选剂量不会假设未知 IOB。',
                state.cobG === null && '实时 COB 缺失；当前消化吸收状态按 0 g 初始化。',
                '不使用历史餐食或运动进行患者拟合；预测从当前观测状态开始。',
            ]),
        },
        evidence,
        plan: {
            candidateCount: 2,
            candidates: simulated,
            counterfactuals,
            maxReplanIterations: 3,
            selectionRule: '保留两个候选及曲线；从当前观测状态向前仿真，并按动作数据和仿真安全结果选择候选。',
        },
        finalAction: selectedPassed && selected ? {
            status: finalStatus,
            selectedPlanId: selected.action.id,
            action: selected.action,
            predicted: selected.metrics,
            warnings: selected.comparisonWarnings,
            executable: false,
            destination: 'human_review_only',
            notice: '候选已通过数据和仿真门禁，仅供人工审核；不会向 Nightscout、泵或 Profile 写入数据。',
        } : {
            status: finalStatus,
            selectedPlanId: null,
            action: null,
            executable: false,
            destination: 'human_review_only',
            warnings: compact([
                ...(selected?.comparisonWarnings ?? []),
                ...(selected?.selectionWarnings ?? ['no_candidate_generated']),
            ]),
            notice: '没有候选通过全部安全门禁；保留两条仿真曲线供解释，不输出患者数值动作。',
        },
        trace: [
            { step: 'observe', status: 'completed', detail: '读取当前节点之前的 CGM、治疗、Profile 与 DeviceStatus。' },
            { step: 'model', status: 'completed', detail: '从当前 CGM、趋势、IOB/COB 与 Profile 初始化；未运行历史回放或 RMSE 校准。' },
            {
                step: 'retrieve',
                status: evidence.received ? 'completed' : 'not_provided',
                detail: evidence.received
                    ? `接收 ${evidence.queryCount} 条场景查询、${evidence.approvedCount} 条已审核证据引用；社区候选不授权数值动作。`
                    : '命令行模式未提供 App 侧知识检索上下文。',
            },
            { step: 'plan', status: 'completed', detail: '由确定性代码生成恰好两个候选。' },
            { step: 'simulate', status: 'completed', detail: '从同一个在线患者估计状态分叉，输出 30/60/120 分钟预测点，并最多重规划 3 次。' },
            { step: 'action', status: finalStatus, detail: selectedPassed && selected ? `选择 ${selected.action.id}，仅供人工审核。` : '没有候选通过全部安全门禁。' },
        ],
    }
    return payload
}

export type OnlinePatientLoopResult = ReturnType<typeof runOnlinePatientLoop>

export function runEmbeddedLoopInsightSimulation(options: {
    input: OnlineInput
    approvedHypoCarbsG?: number | null
    decisionEvidence?: DecisionEvidenceContext
}) {
    return runOnlinePatientLoop(options.input, {
        approvedHypoCarbsG: options.approvedHypoCarbsG,
        decisionEvidence: options.decisionEvidence,
    })
}

export function onlineInputFromAppPayload(payload: AppSimulationPayload): OnlineInput {
    if (!payload || !Array.isArray(payload.entries) || !payload.entries.length) {
        throw new Error('App payload is missing glucose entries.')
    }
    if (!payload.profile?.store) throw new Error('App payload is missing a Nightscout profile.')
    const timestamps = payload.entries
        .map(entry => Number(entry.date) || Date.parse(entry.dateString ?? ''))
        .filter(Number.isFinite)
    if (!timestamps.length) throw new Error('App payload has no valid glucose timestamps.')
    const asOf = payload.asOf ? new Date(payload.asOf) : new Date(Math.max(...timestamps))
    if (!Number.isFinite(asOf.valueOf())) throw new Error('App payload has an invalid asOf timestamp.')
    const profileStore = payload.profile.store[payload.profile.defaultProfile ?? '']
        ?? payload.profile.store.Default
        ?? Object.values(payload.profile.store)[0]
    if (!profileStore) throw new Error('App payload profile has no usable store.')
    const start = new Date(asOf.valueOf() - 24 * HOUR)
    const sourceUrl = /^https?:\/\//.test(payload.sourceUrl ?? '')
        ? payload.sourceUrl!
        : 'https://sweetonline.app.local'
    return {
        sourceUrl,
        sourceKind: 'app_data_snapshot',
        asOf,
        entries: normalizeEntries(payload.entries, start, asOf),
        treatments: normalizeTreatments(payload.treatments ?? [], start, asOf),
        profile: payload.profile,
        profileStore,
        deviceStatus: payload.deviceStatus ?? null,
    }
}

function normalizeDecisionEvidence(
    evidence?: DecisionEvidenceContext,
): DecisionEvidenceContext & { received: boolean } {
    const emptyCoverage: DecisionEvidenceContext['coverage'] = {
        hypoglycemia: false,
        falling_with_iob: false,
        correction_bolus: false,
        carb_insulin_matching: false,
        data_uncertainty: false,
    }
    if (!evidence || evidence.schemaVersion !== 'decision-evidence-v1') {
        return {
            schemaVersion: 'decision-evidence-v1',
            queryCount: 0,
            approvedCount: 0,
            coverage: emptyCoverage,
            missingTopics: [],
            sourceRefs: [],
            communityPolicy: 'pending_zsxq_not_eligible_for_action',
            received: false,
        }
    }
    return {
        schemaVersion: 'decision-evidence-v1',
        queryCount: Math.max(0, Math.floor(Number(evidence.queryCount) || 0)),
        approvedCount: Math.max(0, Math.floor(Number(evidence.approvedCount) || 0)),
        coverage: {
            hypoglycemia: evidence.coverage?.hypoglycemia === true,
            falling_with_iob: evidence.coverage?.falling_with_iob === true,
            correction_bolus: evidence.coverage?.correction_bolus === true,
            carb_insulin_matching: evidence.coverage?.carb_insulin_matching === true,
            data_uncertainty: evidence.coverage?.data_uncertainty === true,
        },
        missingTopics: Array.isArray(evidence.missingTopics)
            ? evidence.missingTopics.filter(item => typeof item === 'string').slice(0, 10)
            : [],
        sourceRefs: Array.isArray(evidence.sourceRefs)
            ? evidence.sourceRefs.filter(item => typeof item === 'string').slice(0, 12)
            : [],
        communityPolicy: 'pending_zsxq_not_eligible_for_action',
        received: true,
    }
}

function applyEvidenceGate(
    candidates: [CandidateAction, CandidateAction],
    evidence: DecisionEvidenceContext & { received: boolean },
): [CandidateAction, CandidateAction] {
    if (!evidence.received) return candidates
    return candidates
}

function buildDecisionInput(input: OnlineInput) {
    const latest = input.entries.at(-1)!
    const status = input.deviceStatus
    const store = input.profileStore
    const seconds = secondsFromMidnight(input.asOf, store.timezone)
    const normalizeGlucoseUnit = (value: number | null) => normalizeProfileGlucoseUnit(value, store.units)
    const activeIsf = normalizeGlucoseUnit(scheduleValue(store.sens, seconds))
    const targetLow = normalizeGlucoseUnit(scheduleValue(store.target_low, seconds))
    const targetHigh = normalizeGlucoseUnit(scheduleValue(store.target_high, seconds))
    const iobU = finiteOrNull(status?.loop?.iob?.iob ?? status?.openaps?.iob?.iob)
    const cobG = finiteOrNull(status?.loop?.cob?.cob ?? status?.openaps?.suggested?.COB)
    const carbs = input.treatments.filter(treatment => Number(treatment.carbs) > 0)
    const mealBolusWithoutCarbs = input.treatments.filter(treatment =>
        treatment.eventType === 'Meal Bolus'
        && Number(treatment.insulin ?? 0) > 0
        && !(Number(treatment.carbs ?? 0) > 0),
    ).length
    const recent = input.entries.filter(entry => entry.date >= input.asOf.valueOf() - 2 * HOUR)
    const externalPrediction = extractExternalPrediction(status)
    return {
        currentGlucoseMgdl: latest.sgv,
        currentAt: new Date(latest.date).toISOString(),
        slope30MinMgdlPerMin: regressionSlope(
            input.entries.filter(entry => entry.date >= input.asOf.valueOf() - 30 * MINUTE),
        ),
        projected30MinMgdl: externalPrediction.eventualBgMgdl,
        externalPrediction,
        iobU,
        cobG,
        activeBasalUph: finiteOrNull(status?.openaps?.suggested?.rate)
            ?? scheduleValue(store.basal, seconds),
        scheduledBasalUph: scheduleValue(store.basal, seconds),
        isfMgdlPerU: activeIsf,
        carbRatioGPerU: scheduleValue(store.carbratio, seconds),
        targetLowMgdl: targetLow,
        targetHighMgdl: targetHigh,
        diaHours: finiteOrNull(store.dia),
        pumpSuspended: status?.pump?.suspended ?? null,
        carbHistoryPresent: carbs.length > 0,
        mealBolusWithoutCarbs,
        carbsInferenceDisabled: mealBolusWithoutCarbs > 0,
        recentGlucosePoints: recent.length,
        blockers: compact([
            recent.length < 18 && 'recent_glucose_history_insufficient',
            iobU === null && 'iob_missing',
            cobG === null && 'cob_missing',
            activeIsf === null && 'isf_missing',
            targetLow === null && 'target_missing',
            targetHigh === null && 'target_missing',
            status?.pump?.suspended === true && 'pump_suspended',
            carbs.length === 0 && 'carb_treatment_history_missing',
            mealBolusWithoutCarbs > 0 && 'meal_bolus_without_carbs',
        ]),
    }
}

function initializeFromCurrentState(
    input: OnlineInput,
    state: ReturnType<typeof buildDecisionInput>,
): CurrentStateInitialization {
    const patient = createPatient(input, 1, 1)
    patient.getPatientProfile()
    const parameters = patient.evaluateParameterValuesAt(input.asOf)
    const ag = finiteOrNull(parameters.AG) ?? 0.8
    const tauM = finiteOrNull(parameters.tau_m) ?? 60
    const vg = finiteOrNull(parameters.Vg) ?? 1.6
    const bodyWeight = finiteOrNull(parameters.BW) ?? 70
    const p1 = finiteOrNull(parameters.p1) ?? 0.0041
    const gb = finiteOrNull(parameters.Gb) ?? 172
    const glucose = state.currentGlucoseMgdl
    const cobMg = Math.max(0, state.cobG ?? 0) * 1000 * ag
    const d1 = cobMg / 2
    const d2 = cobMg / 2
    const absorption = d2 / tauM / (vg * bodyWeight)
    const observedSlope = state.slope30MinMgdlPerMin ?? 0
    const insulinEffect = (
        -p1 * (glucose - gb)
        + absorption
        - observedSlope
    ) / Math.max(glucose, 1)
    const patientState: PatientState = {
        ...patient.getInitialState(),
        G: glucose,
        D1: d1,
        D2: d2,
        X: insulinEffect,
    }
    return { patientState, parameters: { p1Multiplier: 1, p3Multiplier: 1 } }
}

function createPatient(input: OnlineInput, p1Multiplier: number, p3Multiplier: number) {
    const seconds = secondsFromMidnight(input.asOf, input.profileStore.timezone)
    const targetLow = normalizeProfileGlucoseUnit(
        scheduleValue(input.profileStore.target_low, seconds),
        input.profileStore.units,
    ) ?? 90
    const targetHigh = normalizeProfileGlucoseUnit(
        scheduleValue(input.profileStore.target_high, seconds),
        input.profileStore.units,
    ) ?? 110
    return new VirtualPatientDeichmann({
        Gpeq: (targetLow + targetHigh) / 2,
        p1: 0.0041 * p1Multiplier,
        p3: 6.913e-6 * p3Multiplier,
    })
}

function createTwoCandidates(
    state: ReturnType<typeof buildDecisionInput>,
    approvedHypoCarbsG: number | null,
): [CandidateAction, CandidateAction] {
    const current = state.currentGlucoseMgdl
    const target = state.targetLowMgdl !== null && state.targetHighMgdl !== null
        ? (state.targetLowMgdl + state.targetHighMgdl) / 2
        : null
    if (current < 70 || (state.projected30MinMgdl ?? Infinity) < 70) {
        return [
            {
                id: 'plan_a', kind: 'carb_rescue', insulinU: 0,
                carbsG: approvedHypoCarbsG ?? DEFAULT_HYPO_CARBS_G, recheckMinutes: 15,
                blockers: [],
            },
            {
                id: 'plan_b', kind: 'observe_and_recheck', insulinU: 0,
                carbsG: 0, recheckMinutes: 5,
                blockers: ['low_glucose_requires_active_protocol'],
            },
        ]
    }
    if (target !== null && state.isfMgdlPerU !== null && state.iobU !== null
        && current > (state.targetHighMgdl ?? 180)) {
        const correction = Math.max(0, (current - target) / state.isfMgdlPerU - state.iobU)
        const numericBlockers = state.blockers.filter(blocker =>
            blocker !== 'target_missing'
            && blocker !== 'carb_treatment_history_missing'
            && blocker !== 'meal_bolus_without_carbs',
        )
        return [
            {
                id: 'plan_a', kind: 'observe_and_recheck', insulinU: 0,
                carbsG: 0, recheckMinutes: 15, blockers: [],
            },
            {
                id: 'plan_b', kind: 'correction_bolus', insulinU: round(correction, 3),
                carbsG: 0, recheckMinutes: 30, blockers: numericBlockers,
            },
        ]
    }
    return [
        {
            id: 'plan_a', kind: 'observe_and_recheck', insulinU: 0,
            carbsG: 0, recheckMinutes: 30, blockers: [],
        },
        {
            id: 'plan_b', kind: 'observe_and_recheck', insulinU: 0,
            carbsG: 0, recheckMinutes: 15, blockers: [],
        },
    ]
}

function createCounterfactuals(
    input: OnlineInput,
    initialization: CurrentStateInitialization,
    state: ReturnType<typeof buildDecisionInput>,
) {
    const projectedLow = state.currentGlucoseMgdl < 70
        || (state.externalPrediction.eventualBgMgdl ?? Infinity) < 70
        || (state.externalPrediction.lowestPredBgMgdl ?? Infinity) < 70
    if (!projectedLow) return []
    return [5, 10, 15, 20].map(carbsG => {
        const action: CandidateAction = {
            id: 'plan_a',
            kind: 'carb_rescue',
            insulinU: 0,
            carbsG,
            recheckMinutes: 15,
            blockers: ['counterfactual_only', 'not_patient_protocol'],
        }
        const metrics = forecast(input, initialization, action)
        return {
            kind: 'carb_rescue_counterfactual',
            carbsG,
            metrics,
            validation: {
                passed: validateForecast(metrics, state.externalPrediction).length === 0,
                reasons: validateForecast(metrics, state.externalPrediction),
            },
            executable: false,
            destination: 'research_counterfactual_only',
            notice: '反事实补碳 sweep 仅用于解释模型响应；没有专家批准协议时不得转为患者动作。',
        }
    })
}

function simulateWithReplan(
    input: OnlineInput,
    initialization: CurrentStateInitialization,
    state: ReturnType<typeof buildDecisionInput>,
    original: CandidateAction,
) {
    let action = { ...original }
    const attempts: ForecastAttempt<ForecastMetrics>[] = []
    for (let iteration = 0; iteration < 3; iteration += 1) {
        const metrics = forecast(input, initialization, action)
        const reasons = validateForecast(metrics, state.externalPrediction)
        attempts.push({ iteration, action: { ...action }, metrics, reasons })
        if (!reasons.length) break
        const refined = refineAction(action, reasons)
        if (JSON.stringify(refined) === JSON.stringify(action)) break
        action = refined
    }
    const finalAttempt = selectFinalAttempt(attempts)
    const comparisonWarnings = compareExternalPrediction(
        finalAttempt.metrics,
        state.externalPrediction,
    )
    return {
        action: finalAttempt.action,
        initialAction: original,
        metrics: finalAttempt.metrics,
        validation: { passed: finalAttempt.reasons.length === 0, reasons: finalAttempt.reasons },
        comparisonWarnings,
        replanned: attempts.length > 1,
        replanAttempts: attempts,
        score: candidateScore(finalAttempt.metrics, finalAttempt.reasons),
        executable: false,
        destination: 'human_review_only',
    }
}

function forecast(input: OnlineInput, initialization: CurrentStateInitialization, action: CandidateAction): ForecastMetrics {
    const patient = createPatient(input, initialization.parameters.p1Multiplier, initialization.parameters.p3Multiplier)
    patient.setInitialState(
        initialization.patientState as Parameters<typeof patient.setInitialState>[0],
    )
    const boluses = action.insulinU > 0
        ? [{ at: input.asOf.valueOf(), insulinU: action.insulinU }]
        : []
    const meals: Meal[] = action.carbsG > 0
        ? [{ start: input.asOf, duration: 5, carbs: action.carbsG }]
        : []
    const simulator = configuredSimulator(
        patient,
        new TimelineController(time => basalAt(input, time), boluses),
        meals,
        input.asOf,
        new Date(input.asOf.valueOf() + FORECAST_HOURS * HOUR),
    )
    const result = simulator.runSimulation()
    return summarize(result.map(point => point.y.Gp))
}

function validateForecast(metrics: ForecastMetrics, _externalPrediction: ReturnType<typeof extractExternalPrediction>): string[] {
    return compact([
        metrics.minMgdl < 70 && 'predicted_below_70',
        metrics.maxMgdl > 250 && 'predicted_above_250',
        metrics.tbrPercent > MAX_ALLOWED_TBR_PERCENT && 'predicted_tbr_above_limit',
        metrics.endMgdl < 70 && 'forecast_end_below_70',
        metrics.endMgdl > 180 && 'forecast_end_above_180',
    ])
}

function compareExternalPrediction(
    metrics: ForecastMetrics,
    externalPrediction: ReturnType<typeof extractExternalPrediction>,
): string[] {
    return compact([
        externalPrediction.lowestPredBgMgdl !== null
            && externalPrediction.lowestPredBgMgdl < 70
            && Math.min(metrics.glucoseAt30Min, metrics.glucoseAt60Min, metrics.glucoseAt120Min) >= 90
            && 'prediction_model_disagreement',
        externalPrediction.eventualBgMgdl !== null
            && externalPrediction.eventualBgMgdl < 70
            && metrics.glucoseAt30Min >= 70
            && metrics.glucoseAt60Min >= 70
            && 'external_low_projection_unresolved',
    ])
}

function configuredSimulator(
    patient: InstanceType<typeof VirtualPatientDeichmann>,
    controller: Controller,
    meals: Meal[],
    start: Date,
    end: Date,
) {
    const simulator = new Simulator()
    simulator.setPatient(patient)
    simulator.setController(controller)
    simulator.setSensor(new IdealCGM())
    simulator.setActuator(new StaticInsulinPump())
    simulator.setMeals(meals)
    simulator.setExerciseUnits([])
    simulator.setOptions({ t0: start, tmax: end, dt: 1, seed: 42 })
    return simulator
}

const emptyParameters = {} satisfies ParameterDescriptions
const timelineProfile: ModuleProfile = {
    type: 'controller', id: 'OnlineTimelineController', version: '0.1.0', name: 'Online timeline replay',
}

class TimelineController extends AbstractController<typeof emptyParameters> implements Controller {
    private emitted = new Set<number>()

    constructor(
        private readonly basalAtTime: (time: Date) => number,
        private readonly boluses: Array<{ at: number, insulinU: number }>,
    ) {
        super({ samplingTime: 1 })
    }

    getModelInfo() { return timelineProfile }
    getParameterDescription() { return emptyParameters }
    getInputList(): Array<keyof Measurement> { return ['CGM'] }
    getOutputList(): Array<keyof ControllerOutput> { return ['iir', 'ibolus'] }
    override reset(t: Date): void { super.reset(t); this.emitted.clear() }

    update(t: Date, _s: TracedMeasurement, _a: AnnouncementList = {}): void {
        const output: ControllerOutput = { iir: Math.max(0, this.basalAtTime(t)) }
        for (const bolus of this.boluses) {
            if (!this.emitted.has(bolus.at) && Math.abs(t.valueOf() - bolus.at) < MINUTE / 2) {
                output.ibolus = bolus.insulinU
                this.emitted.add(bolus.at)
            }
        }
        this.output = output
    }
}

function basalAt(input: OnlineInput, time: Date): number {
    const active = tempBasalIntervals(input.treatments)
        .find(item => item.start <= time.valueOf() && item.end > time.valueOf())
    return active?.rate ?? scheduleValue(
        input.profileStore.basal,
        secondsFromMidnight(time, input.profileStore.timezone),
    ) ?? 0
}

function tempBasalIntervals(treatments: Treatment[]) {
    const tempBasals = treatments
        .filter(item => item.eventType === 'Temp Basal')
        .map(item => ({
            treatment: item,
            start: treatmentTime(item),
            rate: finiteOrNull(item.absolute ?? item.rate),
        }))
        .filter((item): item is { treatment: Treatment, start: number, rate: number } =>
            item.start !== null && item.rate !== null,
        )
        .sort((a, b) => a.start - b.start)
    return tempBasals
        .map((item, index) => {
            const explicitEnd = finiteOrNull(item.treatment.endmills)
            const durationMin = finiteOrNull(item.treatment.duration)
            const durationMs = finiteOrNull(item.treatment.durationInMilliseconds)
                ?? (durationMin !== null ? durationMin * MINUTE : null)
            const nextStart = tempBasals[index + 1]?.start ?? null
            const inferredEnd = explicitEnd
                ?? (durationMs !== null && durationMs > 0 ? item.start + durationMs : null)
                ?? (nextStart !== null && nextStart - item.start <= 3 * HOUR ? nextStart : null)
            return inferredEnd && inferredEnd > item.start
                ? { start: item.start, end: inferredEnd, rate: item.rate }
                : null
        })
        .filter((item): item is { start: number, end: number, rate: number } => item !== null)
        .sort((a, b) => b.start - a.start)
}

function normalizeEntries(entries: Entry[], start: Date, end: Date): Entry[] {
    const unique = new Map<number, Entry>()
    for (const entry of entries) {
        const date = Number(entry.date) || Date.parse(entry.dateString ?? '')
        const sgv = Number(entry.sgv)
        if (Number.isFinite(date) && Number.isFinite(sgv) && sgv >= 20 && sgv <= 600
            && date >= start.valueOf() && date <= end.valueOf()) unique.set(date, { ...entry, date, sgv })
    }
    return [...unique.values()].sort((a, b) => a.date - b.date)
}

function normalizeTreatments(treatments: Treatment[], start: Date, end: Date): Treatment[] {
    return treatments.filter(item => {
        const time = treatmentTime(item)
        return time !== null && time >= start.valueOf() && time <= end.valueOf()
    })
}

function treatmentTime(item: Treatment): number | null {
    const value = Date.parse(item.created_at ?? item.timestamp ?? '')
    return Number.isFinite(value) ? value : null
}

function scheduleValue(entries: ScheduleEntry[] | undefined, seconds: number): number | null {
    if (!entries?.length) return null
    const sorted = [...entries].sort((a, b) => a.timeAsSeconds - b.timeAsSeconds)
    let active = sorted.at(-1)!
    for (const entry of sorted) {
        if (seconds >= entry.timeAsSeconds) active = entry
        else break
    }
    return finiteOrNull(active.value)
}

function normalizeProfileGlucoseUnit(value: number | null, units?: string): number | null {
    if (value === null) return null
    return /mmol/i.test(units ?? '') ? round(value * 18, 0) : value
}

function secondsFromMidnight(date: Date, timezone?: string): number {
    if (timezone) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
            }).formatToParts(date)
            const value = (type: 'hour' | 'minute' | 'second') =>
                Number(parts.find(part => part.type === type)?.value ?? 0)
            return value('hour') * 3600 + value('minute') * 60 + value('second')
        }
        catch { /* use host time below */ }
    }
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
}

function regressionSlope(entries: Entry[]): number | null {
    if (entries.length < 3) return null
    const origin = entries[0].date
    const xs = entries.map(entry => (entry.date - origin) / MINUTE)
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
    const meanY = entries.reduce((sum, entry) => sum + entry.sgv, 0) / entries.length
    const numerator = entries.reduce((sum, entry, index) =>
        sum + (xs[index] - meanX) * (entry.sgv - meanY), 0)
    const denominator = xs.reduce((sum, value) => sum + Math.pow(value - meanX, 2), 0)
    return denominator ? round(numerator / denominator, 3) : null
}

function extractExternalPrediction(status: DeviceStatus | null) {
    const predValues = Object.values(status?.openaps?.suggested?.predBGs ?? {})
        .flat()
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value >= 20 && value <= 600)
    return {
        source: predValues.length ? 'openaps_predBGs' : 'openaps_eventualBG',
        eventualBgMgdl: finiteOrNull(status?.openaps?.suggested?.eventualBG),
        lowestPredBgMgdl: predValues.length ? round(Math.min(...predValues), 1) : null,
        horizonPoints: predValues.length,
    }
}

function summarize(values: number[]): ForecastMetrics {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const minMgdl = Math.min(...values)
    const minIndex = values.findIndex(value => value === minMgdl)
    return {
        meanMgdl: round(mean, 2),
        minMgdl: round(minMgdl, 2),
        minAtMinutes: minIndex,
        maxMgdl: round(Math.max(...values), 2),
        endMgdl: round(values.at(-1)!, 2),
        glucoseAt30Min: valueAtMinute(values, 30),
        glucoseAt60Min: valueAtMinute(values, 60),
        glucoseAt120Min: valueAtMinute(values, 120),
        tirPercent: round(values.filter(value => value >= 70 && value <= 180).length / values.length * 100, 2),
        tbrPercent: round(values.filter(value => value < 70).length / values.length * 100, 2),
        tarPercent: round(values.filter(value => value > 180).length / values.length * 100, 2),
        points: values
            .map((glucoseMgdl, minutes) => ({ minutes, glucoseMgdl: round(glucoseMgdl, 2) }))
            .filter(point => point.minutes % 5 === 0 || point.minutes === values.length - 1),
    }
}

function valueAtMinute(values: number[], minute: number): number {
    const index = Math.max(0, Math.min(values.length - 1, minute))
    return round(values[index], 2)
}

function candidateScore(metrics: ForecastMetrics, reasons: string[]): number {
    if (reasons.length) return 1e6 + reasons.length * 1e4
    return round(
        metrics.tbrPercent * 10_000
        + metrics.tarPercent * 100
        + Math.abs(metrics.endMgdl - 110),
        2,
    )
}

function summarizeState(state: PatientState) {
    return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, round(value, 6)]))
}

function finiteOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function compact(values: Array<string | false | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function round(value: number, digits = 2): number {
    const factor = Math.pow(10, digits)
    return Math.round(value * factor) / factor
}

function sourceHost(sourceUrl: string): string {
    const match = /^https?:\/\/([^/]+)/.exec(sourceUrl)
    return match?.[1] ?? sourceUrl
}
