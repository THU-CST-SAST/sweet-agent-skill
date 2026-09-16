import { searchSkillKnowledge } from './knowledge';
import type { KnowledgeSnippet } from './types';
import type { PatientDecisionState } from './patientDecisionState';

export type EvidenceTopic =
  | 'hypoglycemia'
  | 'falling_with_iob'
  | 'correction_bolus'
  | 'carb_insulin_matching'
  | 'data_uncertainty';

export interface DecisionEvidenceBundle {
  schemaVersion: 'decision-evidence-v1';
  queries: Array<{ topic: EvidenceTopic; query: string }>;
  approved: KnowledgeSnippet[];
  coverage: Record<EvidenceTopic, boolean>;
  /** Community material is intentionally excluded until expert approval. */
  communityPolicy: 'pending_zsxq_not_eligible_for_action';
  missingTopics: EvidenceTopic[];
}

/**
 * Decision retrieval deliberately runs multiple narrow queries. A single
 * similarity hit is not treated as sufficient evidence for a medical action.
 */
export function retrieveDecisionEvidence(
  state: PatientDecisionState,
): DecisionEvidenceBundle {
  const queries = buildQueries(state);
  const approved = new Map<string, KnowledgeSnippet>();
  const topicHits = new Map<EvidenceTopic, number>();
  for (const policy of searchSkillKnowledge('当前个体动作 患者参数 安全边界 急症', 2)) {
    approved.set(policy.id, policy);
  }
  for (const item of queries) {
    // Numeric action eligibility is grounded in the committed, reviewed skill
    // contract rather than generic lexical hits from the legacy corpus.
    const hits = searchSkillKnowledge(item.query, 4);
    topicHits.set(item.topic, (topicHits.get(item.topic) ?? 0) + hits.length);
    for (const hit of hits) approved.set(hit.id, hit);
  }
  const allTopics: EvidenceTopic[] = [
    'hypoglycemia',
    'falling_with_iob',
    'correction_bolus',
    'carb_insulin_matching',
    'data_uncertainty',
  ];
  const coverage = Object.fromEntries(
    allTopics.map(topic => [topic, (topicHits.get(topic) ?? 0) > 0]),
  ) as Record<EvidenceTopic, boolean>;
  return {
    schemaVersion: 'decision-evidence-v1',
    queries,
    approved: [...approved.values()],
    coverage,
    communityPolicy: 'pending_zsxq_not_eligible_for_action',
    missingTopics: queries
      .map(item => item.topic)
      .filter((topic, index, values) => !coverage[topic] && values.indexOf(topic) === index),
  };
}

function buildQueries(
  state: PatientDecisionState,
): Array<{ topic: EvidenceTopic; query: string }> {
  const result: Array<{ topic: EvidenceTopic; query: string }> = [];
  const glucose = state.glucose.currentMgdl;
  const falling = (state.glucose.slope30Min ?? 0) < -0.3;
  if ((glucose ?? Infinity) < 80 || state.riskFlags.includes('projected_low_30m')) {
    result.push(
      { topic: 'hypoglycemia', query: '低血糖 补糖 葡萄糖 快速吸收 复测' },
      { topic: 'hypoglycemia', query: '低血糖 双15法则 儿童 体重 碳水' },
    );
  }
  if (falling && (state.insulin.iobU ?? 0) > 0) {
    result.push({
      topic: 'falling_with_iob',
      query: 'IOB 活性胰岛素 血糖下降 低血糖 重复注射 风险',
    });
  }
  if ((glucose ?? 0) > (state.therapyProfile.targetHighMgdl ?? 180)) {
    result.push(
      {
        topic: 'correction_bolus',
        query: '高血糖 纠正剂量 胰岛素敏感系数 ISF IOB 活性胰岛素',
      },
      {
        topic: 'correction_bolus',
        query: '纠正胰岛素 目标血糖 重复补针 低血糖风险',
      },
    );
  }
  if ((state.carbs.cobG ?? 0) > 0 || state.carbs.carbs4hG > 0) {
    result.push({
      topic: 'carb_insulin_matching',
      query: '碳水系数 CIR 餐时胰岛素 食物升糖曲线 作用曲线 匹配',
    });
  }
  if (state.dataQuality.missingOrStale.length) {
    result.push({
      topic: 'data_uncertainty',
      query: 'CGM 延迟 数据中断 指尖血糖 复核',
    });
  }
  // Normal states still need evidence about IOB and uncertainty before the
  // planner concludes that observation is preferable to an extra action.
  if (!result.length) {
    result.push(
      {
        topic: 'falling_with_iob',
        query: 'IOB 活性胰岛素 重复注射 风险',
      },
      {
        topic: 'data_uncertainty',
        query: 'CGM 组织间液 延迟 趋势 复核',
      },
    );
  }
  return result;
}
