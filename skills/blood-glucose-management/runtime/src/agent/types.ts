import type { GlucoseEntry, TreatmentEntry } from '../types';
import type { AapsToolCall, AapsToolName } from './aapsTools';

export type AgentTaskRoute =
  | 'rag_qa'
  | 'current_state'
  | 'daily_report'
  | 'weekly_report';

export interface AgentConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentWorkflowStep {
  id: 'route' | 'data' | 'analysis' | 'planning' | 'retrieval' | 'simulation' | 'safety' | 'response';
  label: string;
  status: 'running' | 'completed' | 'skipped' | 'failed';
  detail: string;
}

export interface AgentExecutionPlan {
  objective: string;
  searchQueries: Array<{ purpose: string; query: string }>;
  tools: Array<
    | 'analyze_state'
    | 'search_knowledge'
    | 'run_simulation'
    | 'review_safety'
    | AapsToolName
  >;
  toolCalls: AapsToolCall[];
  recommendationFocus: string[];
  planner: 'model' | 'fallback';
}

export type GlucoseTrend =
  | 'rapidly_rising'
  | 'rising'
  | 'gently_rising'
  | 'stable'
  | 'gently_falling'
  | 'falling'
  | 'rapidly_falling'
  | 'unknown';

export interface AgentDataQuality {
  status: 'good' | 'partial' | 'insufficient';
  validReadings: number;
  expectedReadings: number;
  coveragePercent: number;
  latestReadingAgeMin: number | null;
  maxGapMin: number | null;
  warnings: string[];
}

export interface AgentGlucoseFeatures {
  currentMgdl: number | null;
  currentAt: string | null;
  slope15Min: number | null;
  slope30Min: number | null;
  slope60Min: number | null;
  trend: GlucoseTrend;
  trendMethod: 'linear_regression_30m';
  trendSampleCount: number;
  projected30MinMgdl: number | null;
  meanMgdl: number | null;
  standardDeviationMgdl: number | null;
  cvPercent: number | null;
  minMgdl: number | null;
  maxMgdl: number | null;
  tirPercent: number | null;
  tbrPercent: number | null;
  tarPercent: number | null;
}

export interface AgentTreatmentFeatures {
  bolusTotalU: number;
  carbsTotalG: number;
  bolusCount: number;
  carbCount: number;
  lastBolusAt: string | null;
  minutesSinceLastBolus: number | null;
  lastCarbsAt: string | null;
  minutesSinceLastCarbs: number | null;
}

export interface AgentStateSnapshot {
  schemaVersion: 'agent-state-v1';
  route: AgentTaskRoute;
  builtAt: string;
  window: {
    start: string;
    end: string;
    durationHours: number;
  };
  glucose: AgentGlucoseFeatures;
  treatments: AgentTreatmentFeatures;
  dataQuality: AgentDataQuality;
  riskFlags: string[];
  sourceCounts: {
    glucose: number;
    treatments: number;
  };
}

export interface AgentStateInput {
  route: AgentTaskRoute;
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  now?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
}

export interface ExpertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'info' | 'warning' | 'block';
  threshold?: number;
  unit?: string;
}

export interface ExpertRuleSet {
  schemaVersion: 'expert-rules-v1';
  revision: number;
  updatedAt: string;
  updatedBy: string;
  rules: ExpertRule[];
}

export interface KnowledgeSnippet {
  id: string;
  text: string;
  title: string;
  sourceType: 'app_help' | 'book_note' | 'question_bank' | 'skill' | 'zsxq';
  sourceRef: string;
  reviewStatus: 'approved' | 'pending' | 'rejected';
  trustLevel: 'high' | 'medium' | 'community';
}

export interface AgentAnswer {
  route: AgentTaskRoute;
  text: string;
  state: AgentStateSnapshot;
  sources: KnowledgeSnippet[];
  provider: 'deterministic' | 'zhipu' | 'glm5' | 'kimi' | 'deepseek' | 'gateway' | 'fallback';
  workflow: AgentWorkflowStep[];
  aapsAction?: {
    call?: AapsToolCall;
    command?: string;
    status: 'requires_user_confirmation';
  };
}
