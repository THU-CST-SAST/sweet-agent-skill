import { storage } from '../services/storage';
import type { AgentStateSnapshot, ExpertRuleSet } from './types';

const STORAGE_KEY = 'agent_expert_rules_v1';

export const DEFAULT_EXPERT_RULES: ExpertRuleSet = {
  schemaVersion: 'expert-rules-v1',
  revision: 1,
  updatedAt: '2026-07-11T00:00:00.000Z',
  updatedBy: 'system',
  rules: [
    {
      id: 'block_insufficient_data',
      name: '数据不足时禁止个体化判断',
      description: '有效血糖少于 3 点或覆盖率低于 30% 时，只能提示补充数据。',
      enabled: true,
      severity: 'block',
    },
    {
      id: 'warn_stale_glucose',
      name: '血糖数据过期提醒',
      description: '最新读数超过阈值时，明确说明不是实时状态。',
      enabled: true,
      severity: 'warning',
      threshold: 15,
      unit: 'min',
    },
    {
      id: 'warn_low_glucose',
      name: '低血糖优先级',
      description: '当前血糖低于阈值时，优先提示按既有医疗方案处理并复测。',
      enabled: true,
      severity: 'warning',
      threshold: 70,
      unit: 'mg/dL',
    },
    {
      id: 'warn_rapid_fall',
      name: '快速下降提醒',
      description: '30 分钟回归斜率低于阈值时，突出快速下降风险。',
      enabled: true,
      severity: 'warning',
      threshold: -2,
      unit: 'mg/dL/min',
    },
    {
      id: 'no_executable_dose',
      name: '禁止输出可执行剂量',
      description: '真实数据对话不生成具体胰岛素剂量；数值动作仅允许在隔离仿真中展示。',
      enabled: true,
      severity: 'block',
    },
    {
      id: 'approved_sources_only',
      name: '医疗回答仅引用已审核材料',
      description: '书本和题库可作为高可信来源；知识星球内容须经专家审核后才进入回答。',
      enabled: true,
      severity: 'block',
    },
    {
      id: 'approved_hypo_carbs_g',
      name: '患者低血糖补碳协议',
      description: '仅在专家确认该患者的低血糖方案后启用；阈值表示一次补充的快碳克数。',
      enabled: false,
      severity: 'block',
      threshold: 15,
      unit: 'g',
    },
  ],
};

export function approvedHypoCarbsG(ruleSet: ExpertRuleSet): number | null {
  const rule = ruleSet.rules.find(item =>
    item.id === 'approved_hypo_carbs_g' && item.enabled,
  );
  return rule?.threshold !== undefined
    && Number.isFinite(rule.threshold)
    && rule.threshold > 0
    ? rule.threshold
    : null;
}

export async function loadExpertRules(): Promise<ExpertRuleSet> {
  const stored = await storage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_EXPERT_RULES;
  try {
    const parsed = JSON.parse(stored) as ExpertRuleSet;
    if (parsed.schemaVersion !== 'expert-rules-v1' || !Array.isArray(parsed.rules)) {
      return DEFAULT_EXPERT_RULES;
    }
    const storedById = new Map(parsed.rules.map(rule => [rule.id, rule]));
    return {
      ...parsed,
      rules: [
        ...DEFAULT_EXPERT_RULES.rules.map(rule => storedById.get(rule.id) ?? rule),
        ...parsed.rules.filter(rule =>
          !DEFAULT_EXPERT_RULES.rules.some(defaultRule => defaultRule.id === rule.id),
        ),
      ],
    };
  } catch {
    return DEFAULT_EXPERT_RULES;
  }
}

export async function saveExpertRules(
  next: ExpertRuleSet,
  updatedBy = 'expert',
): Promise<ExpertRuleSet> {
  const saved: ExpertRuleSet = {
    ...next,
    schemaVersion: 'expert-rules-v1',
    revision: next.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

export function activeSafetyMessages(
  state: AgentStateSnapshot,
  ruleSet: ExpertRuleSet,
): string[] {
  const enabled = new Map(
    ruleSet.rules.filter(rule => rule.enabled).map(rule => [rule.id, rule]),
  );
  const messages: string[] = [];
  if (enabled.has('block_insufficient_data') && state.dataQuality.status === 'insufficient') {
    messages.push('当前数据不足，不能形成可靠的个体化判断。');
  }
  const staleRule = enabled.get('warn_stale_glucose');
  if (
    staleRule?.threshold !== undefined &&
    state.dataQuality.latestReadingAgeMin !== null &&
    state.dataQuality.latestReadingAgeMin > staleRule.threshold
  ) {
    messages.push(`最新读数已超过 ${staleRule.threshold} 分钟，以下内容不是实时判断。`);
  }
  const lowRule = enabled.get('warn_low_glucose');
  if (
    lowRule?.threshold !== undefined &&
    (state.glucose.currentMgdl ?? Infinity) < lowRule.threshold
  ) {
    messages.push('检测到低血糖风险，请优先遵循既有医疗方案处理并及时复测。');
  }
  const fallRule = enabled.get('warn_rapid_fall');
  if (
    fallRule?.threshold !== undefined &&
    (state.glucose.slope30Min ?? Infinity) <= fallRule.threshold
  ) {
    messages.push('检测到血糖快速下降，请提高监测频率。');
  }
  return messages;
}
