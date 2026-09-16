export type CandidateAction = {
    id: 'plan_a' | 'plan_b'
    kind: 'observe_and_recheck' | 'correction_bolus' | 'carb_rescue'
    insulinU: number
    carbsG: number
    recheckMinutes: number
    blockers: string[]
}

export type ForecastAttempt<TMetrics = ForecastMetricsSummary> = {
    iteration: number
    action: CandidateAction
    metrics: TMetrics
    reasons: string[]
}

export type SimulatedCandidate = {
    action: CandidateAction
    validation: { passed: boolean, reasons: string[] }
    score: number
}

export type RecommendedCandidate<TCandidate extends SimulatedCandidate = SimulatedCandidate> =
    TCandidate & { selectionWarnings: string[] }

type ForecastMetricsSummary = {
    minMgdl: number
    maxMgdl: number
    endMgdl: number
    tbrPercent: number
    tarPercent: number
}

const lowForecastReasons = new Set([
    'predicted_below_70',
    'predicted_tbr_above_zero',
    'predicted_tbr_above_limit',
    'forecast_end_below_70',
])

const highForecastReasons = new Set([
    'predicted_above_250',
    'forecast_end_above_180',
])

export function refineAction(action: CandidateAction, reasons: string[]): CandidateAction {
    if (action.kind === 'correction_bolus' && reasons.some(reason => lowForecastReasons.has(reason))) {
        return { ...action, insulinU: round(action.insulinU * 0.8, 3) }
    }
    if (action.kind === 'carb_rescue' && reasons.some(reason => lowForecastReasons.has(reason))) {
        return { ...action, carbsG: round(action.carbsG * 1.25, 1) }
    }
    if (action.kind === 'carb_rescue' && reasons.some(reason => highForecastReasons.has(reason))) {
        return { ...action, carbsG: round(action.carbsG * 0.8, 1) }
    }
    return action
}

export function selectFinalAttempt<TMetrics>(attempts: ForecastAttempt<TMetrics>[]): ForecastAttempt<TMetrics> {
    const finalAttempt = attempts.at(-1)
    if (!finalAttempt) throw new Error('No forecast attempts were produced.')
    return finalAttempt
}

export function selectRecommendedCandidate<TCandidate extends SimulatedCandidate>(
    candidates: TCandidate[],
): RecommendedCandidate<TCandidate> | null {
    const preferred = candidates.filter(candidate => candidate.action.blockers.length === 0)
    const pool = preferred.length ? preferred : candidates
    const selected = [...pool].sort((a, b) => a.score - b.score)[0] ?? null
    if (!selected) return null
    return {
        ...selected,
        selectionWarnings: [
            ...selected.action.blockers,
            ...selected.validation.reasons,
        ],
    }
}

function round(value: number, digits = 2): number {
    const factor = Math.pow(10, digits)
    return Math.round(value * factor) / factor
}
