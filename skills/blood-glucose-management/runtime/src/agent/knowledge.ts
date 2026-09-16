import type { KnowledgeSnippet } from './types';
import { GENERATED_KNOWLEDGE } from './generatedKnowledge';
import { GENERATED_SKILL_KNOWLEDGE } from './generatedSkillKnowledge';

const APP_HELP_KNOWLEDGE: KnowledgeSnippet[] = [
  {
    id: 'app-help-capabilities',
    title: '血糖洞察助手能做什么',
    text: 'Agent 对话页支持连续问答、当前状态分析、知识问答、日报、周报和后续建议。模型先制定检索与工具调用计划，App 执行多路知识召回、语义重排、状态分析和仿真，模型再根据工具结果生成回答或建议；报告指标和安全数值由本地确定性代码计算。',
    sourceType: 'app_help',
    sourceRef: 'App 内置说明：Agent 功能范围',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-data-quality',
    title: 'Agent 数据足够、数据不足与覆盖率要求',
    text: '数据是否足够按分析时间窗判断：少于 3 个有效血糖点或覆盖率低于 30% 时为不足；覆盖率达到 30% 后可以形成有限分析；达到 70%，且最新读数不超过 15 分钟、最长中断不超过 20 分钟，才评为良好。完整 24 小时按每 5 分钟一条约有 289 个点，约 87 个点达到 30%，约 203 个点达到 70%。Agent Loop 还要求至少 18 条近期血糖记录和治疗 Profile。',
    sourceType: 'app_help',
    sourceRef: 'App 内置规则：stateBuilder / PlanningLoopDemo',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-state-loop',
    title: '当前状态分析和 Agent Loop 如何工作',
    text: '当前状态分析会读取血糖、趋势、IOB、COB、治疗 Profile、设备状态和数据质量。数据与 Profile 可用时，对话会复用完整 Agent Loop：检索审核证据、生成两个有界候选、调用内置 LoopInsighT1 仿真、比较风险并返回只读建议。缺少条件时仍解释已有状态，同时明确 Loop 未运行的原因。',
    sourceType: 'app_help',
    sourceRef: 'App 内置流程：agentService / simulationClient',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-reports',
    title: '日报、周报和后续建议如何生成',
    text: '日报按日内数据生成，周报使用最近 7 天数据。平均血糖、TIR、TBR、TAR、CV、覆盖率、治疗记录和风险标记由本地工具计算；Agent 根据异常模式制定检索计划，检索并重排相关审核资料，再生成报告解释和后续复盘建议。这些建议不自动修改治疗剂量。',
    sourceType: 'app_help',
    sourceRef: 'App 内置流程：reportGenerator / reportScheduler',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-knowledge',
    title: '知识问答、RAG 和回答依据',
    text: '知识问答采用 Agentic RAG：模型先拆解问题并生成多路查询，手机端从已审核知识库宽召回候选，模型按语义相关性、可信等级和出处去重重排，再依据选中材料回答并显示引用。没有审核证据时，医疗事实必须说明证据不足，不能编造来源。',
    sourceType: 'app_help',
    sourceRef: 'App 内置流程：knowledge / agentService',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-llm-boundary',
    title: 'LLM、本地确定性回答和模型失败兜底',
    text: 'LLM 负责理解连续对话、制定检索与工具计划、语义重排资料，并根据工具结果生成报告、回答和建议。它不重新计算血糖统计或绕过安全工具编造剂量。界面显示“本地确定性回答”表示没有启用模型；显示“模型失败·本地兜底”表示模型调用失败。',
    sourceType: 'app_help',
    sourceRef: 'App 内置说明：zhipuProvider / agentService',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-simulation-missing',
    title: '为什么 Agent Loop 或仿真没有运行',
    text: '常见原因包括近期血糖记录少于 18 条、缺少治疗 Profile、血糖时间戳无效，或输入无法通过 App 隔离校验。外部仿真服务不可用时 App 会回退到内置 LoopInsighT1 kernel，因此“找不到外部服务”本身不应让整个状态分析罢工。',
    sourceType: 'app_help',
    sourceRef: 'App 内置规则：PlanningLoopDemo / simulationClient',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'app-help-safety',
    title: 'Agent 建议为什么只读以及安全门禁如何工作',
    text: 'Agent 可以自动检索、计算、生成候选和运行仿真，但最终建议是 READ ONLY，只进入人工确认。PASSED 表示候选通过当前规则与仿真检查，BLOCKED 表示存在数据、证据或预测风险；App 不会自动写入胰岛素泵或 Nightscout。',
    sourceType: 'app_help',
    sourceRef: 'App 内置安全规则：actionPlanner / simulationClient',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
];

const AAPS_TOOL_SKILL_KNOWLEDGE: KnowledgeSnippet[] = [
  {
    id: 'skill-aaps-agent-tools',
    title: 'AAPS Agent 工具 Skill',
    text: 'AAPS Agent 工具从用户配置的 Nightscout 读取血糖、治疗历史、Profile 和设备状态；用户明确确认后，碳水、Bolus 与临时基础率命令经 HTTPS 中转站发送给 AAPS 虚拟泵，并通过中转站审计记录核验执行结果。命令被中转站接收不等于设备已经执行。缺少饮食、运动或历史校准信息时，应说明限制并继续分析可观察数据，不应仅因此让 Agent 罢工。',
    sourceType: 'skill',
    sourceRef: 'aaps-agent-tools skill · SKILL.md',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
];

// v0 只放已核对的短知识片段。完整 PDF、题库和知识星球内容由离线摄取脚本生成，
// 不在移动端直接抓取，也不让未经审核的社区内容自动进入回答。
export const APPROVED_KNOWLEDGE: KnowledgeSnippet[] = [
  ...APP_HELP_KNOWLEDGE,
  ...AAPS_TOOL_SKILL_KNOWLEDGE,
  {
    id: 'book-cgm-delay',
    title: 'CGM 与真实血糖的差异',
    text: 'CGM 反映的是皮下组织间液葡萄糖，和真实血糖之间可能存在时间延迟。',
    sourceType: 'book_note',
    sourceRef: '《明明白白调血糖（第2版）》鑫导读书笔记，第一课 P1',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'book-basal-first',
    title: '基础与餐时的分析顺序',
    text: '复盘血糖时可先观察基础阶段，再观察餐时；夜间通常比白天受到更少饮食干扰。',
    sourceType: 'book_note',
    sourceRef: '《明明白白调血糖（第2版）》鑫导读书笔记，第一课 P1',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'book-gi-gl',
    title: 'GI 与 GL',
    text: 'GI 主要反映升糖速度，GL 同时考虑食物摄入量和可利用碳水，更适合描述一份食物的升糖负荷。',
    sourceType: 'book_note',
    sourceRef: '《明明白白调血糖（第2版）》鑫导读书笔记，第二课 P36',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'qa-cgm-measures',
    title: '题库：CGM 测量对象',
    text: 'CGM 测量组织间液相关信号，再经算法换算为葡萄糖读数。',
    sourceType: 'question_bank',
    sourceRef: '题库《明明白白调血糖（第2版）》第 2 题',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  {
    id: 'book-individual-response',
    title: '食物反应个体差异',
    text: '不同人对相同食物的血糖反应可能不同，同一个人的反应也会受到当时身体状态影响。',
    sourceType: 'book_note',
    sourceRef: '《明明白白调血糖（第2版）》鑫导读书笔记，第二课 P38',
    reviewStatus: 'approved',
    trustLevel: 'high',
  },
  ...GENERATED_SKILL_KNOWLEDGE,
  ...GENERATED_KNOWLEDGE,
];

export function searchKnowledge(query: string, limit = 2): KnowledgeSnippet[] {
  return rankedKnowledge(query, true)
    .slice(0, limit)
    .map(result => result.item);
}

export function searchKnowledgeCandidates(query: string, limit = 12): KnowledgeSnippet[] {
  return rankedKnowledge(query, false)
    .slice(0, limit)
    .map(result => result.item);
}

export function searchSkillKnowledge(query: string, limit = 4): KnowledgeSnippet[] {
  return rankedKnowledge(query, false)
    .filter(result => result.item.sourceType === 'skill')
    .slice(0, limit)
    .map(result => result.item);
}

function rankedKnowledge(query: string, focused: boolean) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return APPROVED_KNOWLEDGE
    .filter(item => item.reviewStatus === 'approved')
    .map(item => {
      const title = scoreText(item.title, terms);
      const body = scoreText(item.text, terms);
      return {
        item,
        // A focused title match is more useful than a long document that happens
        // to contain many query fragments.
        score: title.score * 4 + body.score + sourcePriority(item.sourceType),
        matchedTerms: new Set([...title.matchedTerms, ...body.matchedTerms]).size,
      };
    })
    .filter(result => focused
      ? result.score >= 4 && result.matchedTerms >= Math.min(2, terms.length)
      : result.score >= 2 && result.matchedTerms >= 1)
    .sort((a, b) => b.score - a.score);
}

function sourcePriority(sourceType: KnowledgeSnippet['sourceType']): number {
  if (sourceType === 'app_help') return 2;
  if (sourceType === 'skill') return 1;
  return 0;
}

function tokenize(value: string): string[] {
  const stopTerms = new Set([
    '多少', '什么', '怎么', '怎样', '如何', '这个', '那个', '可以', '需要',
    '问题', '回答', '为什', '什么',
  ]);
  const tokens = new Set<string>();
  const lower = value.toLowerCase();
  for (const word of lower.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2) tokens.add(word);
  }
  for (const segment of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let index = 0; index < segment.length - 1; index += 1) {
      const token = segment.slice(index, index + 2);
      if (!stopTerms.has(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function scoreText(text: string, terms: string[]): { score: number; matchedTerms: string[] } {
  const normalized = text.toLowerCase();
  const latinWords = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  const matchedTerms: string[] = [];
  const score = terms.reduce((total, term) => {
    const matched = /^[a-z0-9]+$/.test(term)
      ? latinWords.has(term)
      : normalized.includes(term);
    if (matched) matchedTerms.push(term);
    return total + (matched ? term.length : 0);
  }, 0);
  return { score, matchedTerms };
}
