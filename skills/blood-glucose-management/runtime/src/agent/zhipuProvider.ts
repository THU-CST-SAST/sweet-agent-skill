import axios from 'axios';
import {
  LLM_API_BASE_URL,
  LLM_API_KEY,
  LLM_MODEL,
  ZHIPU_API_KEY,
  ZHIPU_MODEL,
} from '../runtime/env';
import type {
  AgentConversationMessage,
  AgentExecutionPlan,
  AgentStateSnapshot,
  AgentTaskRoute,
  ExpertRuleSet,
  KnowledgeSnippet,
} from './types';
import type { PatientDecisionState } from './patientDecisionState';
import {
  AGENT_MODEL_BASE_URL,
  AgentModelConfig,
  hasUsableAgentModelConfig,
  loadAgentModelConfig,
} from './agentModelConfig';

const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

interface ZhipuResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; reasoning_content?: string };
  }>;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

interface ResolvedModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: 'glm5' | 'kimi' | 'deepseek' | 'zhipu' | 'gateway';
}

export async function isZhipuConfigured(): Promise<boolean> {
  return Boolean(await resolveModelConfig());
}

export async function narrationProvider(): Promise<'glm5' | 'kimi' | 'deepseek' | 'zhipu' | 'gateway'> {
  return (await resolveModelConfig())?.provider ?? 'zhipu';
}

export async function narrateWithZhipu(input: {
  route: AgentTaskRoute;
  query: string;
  state: AgentStateSnapshot;
  deterministicDraft: string;
  sources: KnowledgeSnippet[];
  rules: ExpertRuleSet;
  decisionState?: PatientDecisionState;
  conversationHistory?: AgentConversationMessage[];
  executionPlan?: AgentExecutionPlan;
}): Promise<string> {
  const config = await resolveModelConfig();
  if (!config) throw new Error('Narration model API key is not configured');

  const { apiKey, model } = config;
  const endpoint = completionEndpoint(config.baseUrl);
  const isKimi = endpoint.includes('api.kimi.com');
  if (!apiKey || !endpoint.startsWith('https://')) {
    throw new Error('Narration model endpoint is invalid');
  }

  const activeRules = input.rules.rules
    .filter(rule => rule.enabled)
    .map(rule => `${rule.severity}: ${rule.name} — ${rule.description}`)
    .join('\n');
  const evidence = input.sources.length
    ? input.sources
        .map((source, index) =>
          `[${index + 1}] ${source.text}\n出处：${source.sourceRef}；类型：${source.sourceType}；审核：${source.reviewStatus}`,
        )
        .join('\n\n')
    : '本轮没有检索证据，不得补造引用。';
  const stateContext = input.route === 'rag_qa'
    ? '本轮是普通对话或知识问答。除非对话历史中已经给出确定性状态，否则不得猜测用户当前血糖。'
    : input.decisionState
      ? `完整患者决策状态：\n${JSON.stringify(input.decisionState)}`
      : `结构化状态：\n${JSON.stringify(input.state)}`;
  const conversation = (input.conversationHistory ?? [])
    .slice(-8)
    .map(message => `${message.role === 'user' ? '用户' : '助手'}：${message.text.slice(0, 1200)}`)
    .join('\n') || '无历史对话。';

  const messages = [
        {
          role: 'system',
          content: [
            '你是守糖卫士的血糖数据解释助手。',
            '你必须执行 blood-glucose-management Skill 的回答契约：先区分纯知识、回顾分析、参数教育、当前动作与急症风险，再按任务选择证据。',
            '证据冲突时依次服从现场急症安全、患者既有方案、设备/Profile、当前指南、Skill 审核知识；不得用教材案例补齐患者参数。',
            'Skill 中标为经验或综合推导的内容只能作为假设；题库错题必须采用解析中的纠正，不得把错误题干写成结论。',
            '所有统计值、趋势、风险标记都已经由确定性代码计算；不得重新计算或篡改。',
            '支持普通连续对话、知识库问答、当前状态与 Agent Loop 分析、日报、周报和基于报告的后续建议。',
            '真实数据场景禁止输出可直接执行的胰岛素剂量或自动治疗动作。',
            '不得在面向患者的最终文本中复述已被安全门或仿真否决的数值剂量。',
            '引用知识时仅使用给定证据，并在相关表述后写 [1] 这样的编号。',
            '普通追问应结合最近对话理解“这个、多少才够、然后呢”等省略表达，不要转移到无关主题。',
            '没有检索证据时可以回答日常交流和 App 使用问题；医疗事实必须说明证据不足，不得凭模型记忆编造。',
            '知识库问答只回答用户提出的问题，不得无故附加当前血糖、覆盖率、风险或治疗状态。',
            '表达简洁、明确区分事实、推断和数据不足。',
            '如果确定性草稿标记预测低血糖或活动胰岛素风险，不得将其改写为低风险。',
            '最终回答使用纯文本和中文编号，不使用 Markdown 星号、井号或表格。',
            '最终回答控制在 900 个中文字以内，但必须写完句子，并完整覆盖状态、依据、仿真结果和下一步。',
            '你不是润色器：必须依据 Agent 执行计划和工具结果独立完成分析、取舍和建议生成。',
            '日报和周报必须解释主要模式，结合检索证据生成针对下一周期的观察与复盘建议。',
            '当前状态任务必须比较仿真候选及预测结果，只能推荐通过安全复核的候选。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `任务路由：${input.route}`,
            `用户问题：${input.query}`,
            `最近对话：\n${conversation}`,
            `Agent 执行计划：\n${JSON.stringify(input.executionPlan ?? null)}`,
            `确定性草稿：\n${input.deterministicDraft}`,
            stateContext,
            `已启用专家规则：\n${activeRules}`,
            `检索证据：\n${evidence}`,
            '请在不改变任何数值的前提下组织完整中文回答；若某一步未运行，明确说明原因。',
          ].join('\n\n'),
        },
      ];
  const requestOptions = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  };
  const response = await axios.post<ZhipuResponse>(
    endpoint,
    {
      model,
      messages,
      temperature: isKimi ? 1 : 0.2,
      max_tokens: 2600,
      stream: false,
      ...(isKimi ? {
        thinking: { type: 'enabled' },
        reasoning_effort: 'low',
        top_p: 0.95,
      } : {}),
    },
    requestOptions,
  );
  const firstChoice = response.data.choices?.[0];
  let text = firstChoice?.message?.content?.trim();
  if (!text) throw new Error('Narration model returned an empty response');
  if (firstChoice?.finish_reason === 'length') {
    const continuation = await axios.post<ZhipuResponse>(
      endpoint,
      {
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: '上一段因长度限制被截断。请仅续写未完成部分，补齐仿真结论和下一步，并以完整句子结束。',
          },
        ],
        temperature: 0.2,
        max_tokens: 1600,
        stream: false,
      },
      requestOptions,
    );
    const continuationText = continuation.data.choices?.[0]?.message?.content?.trim();
    if (continuationText) text = `${text}\n${continuationText}`;
  }
  return cleanNarration(text);
}

export async function planAgentTaskWithModel(input: {
  route: AgentTaskRoute;
  query: string;
  state: AgentStateSnapshot;
  conversationHistory?: AgentConversationMessage[];
}): Promise<AgentExecutionPlan> {
  const config = await resolveModelConfig();
  if (!config) throw new Error('Agent planner model is not configured');
  const conversation = (input.conversationHistory ?? [])
    .slice(-6)
    .map(message => `${message.role}: ${message.text.slice(0, 500)}`)
    .join('\n');
  const response = await axios.post<ZhipuResponse>(
    completionEndpoint(config.baseUrl),
    {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: [
            '你是血糖管理 Agent 的规划器，不直接回答用户。',
            '按 blood-glucose-management Skill 工作：先判断任务类别和风险，再围绕对应主题、术语/公式、安全契约生成检索词。',
            '涉及当前动作、低血糖、高血糖、剂量、泵或特殊人群时，检索词必须同时覆盖具体主题和安全边界；不得用教材案例填补患者参数。',
            '你的任务是制定检索和工具调用计划。每个任务都必须调用 search_knowledge，并生成 2 到 4 个具体检索词。',
            '当前状态或建议任务应调用 analyze_state、search_knowledge、run_simulation、review_safety。',
            '日报或周报应调用 analyze_state、search_knowledge、review_safety，并根据指标异常决定检索主题。',
            '知识问答应调用 search_knowledge；涉及患者状态时再调用 analyze_state。',
            '涉及 AAPS、IOB、COB、Profile、泵或 Loop 时，用 toolCalls 给出结构化调用；不得假称已经读取或执行。',
            '可用读取工具：aaps_read_state、aaps_read_history、aaps_read_profile、aaps_read_pump_status。',
            '可用动作工具：aaps_record_carbs、aaps_bolus、aaps_temp_basal_absolute、aaps_temp_basal_percent、aaps_cancel_temp_basal。',
            '读取工具从用户配置的 Nightscout 获取患者数据；动作工具经 HTTPS AAPS 中转站发送给设备。',
            '工具参数分别使用 carbsG、insulinU、rateUph、percent、durationMinutes；读取历史使用 historyMinutes。',
            '用户未明确要求治疗动作时不得创建动作调用。动作调用只代表请求，执行端仍会要求用户确认。',
            '不得假造工具结果。',
            '只输出 JSON，不使用 Markdown。',
            'JSON 结构：{"objective":"...","searchQueries":[{"purpose":"...","query":"..."}],"tools":["..."],"toolCalls":[{"id":"稳定且唯一的调用ID","name":"aaps_read_state","arguments":{"historyMinutes":120}}],"recommendationFocus":["..."]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `任务类型：${input.route}`,
            `用户问题：${input.query}`,
            `最近对话：${conversation || '无'}`,
            `本地状态工具摘要：${JSON.stringify(input.state)}`,
          ].join('\n\n'),
        },
      ],
      temperature: 0.1,
      max_tokens: 3000,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    },
  );
  const content = response.data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Agent planner returned an empty plan');
  return parseAgentExecutionPlan(parseJsonObject(content));
}

export async function rerankKnowledgeWithModel(input: {
  query: string;
  plan: AgentExecutionPlan;
  candidates: KnowledgeSnippet[];
  limit?: number;
}): Promise<KnowledgeSnippet[]> {
  if (!input.candidates.length) return [];
  const config = await resolveModelConfig();
  if (!config) throw new Error('Agent reranker model is not configured');
  const limit = Math.max(1, Math.min(input.limit ?? 6, 8));
  const response = await axios.post<ZhipuResponse>(
    completionEndpoint(config.baseUrl),
    {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Agentic RAG 的证据重排器，不回答用户问题。',
            '根据用户问题、检索计划、材料语义相关性、可信等级和出处，选择最有用且不重复的证据。',
            '医疗知识、状态分析和行动任务优先选择 sourceType=skill 的主题资料，并同时保留相关安全契约；App 功能问题优先 app_help。',
            '题库判断为错时只能选择包含纠正解析的完整材料；经验 EXP 和综合推导 SYN 不得冒充患者事实或处方。',
            '不要因为材料很长就优先选择；不要选择只共享泛化词但主题无关的材料。',
            `最多选择 ${limit} 条。只输出 JSON：{"selectedIds":["id1","id2"],"reason":"..."}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `用户问题：${input.query}`,
            `执行计划：${JSON.stringify(input.plan)}`,
            `候选材料：${JSON.stringify(input.candidates.map(item => ({
              id: item.id,
              title: item.title,
              text: item.text.slice(0, 700),
              sourceRef: item.sourceRef,
              trustLevel: item.trustLevel,
            })))}`,
          ].join('\n\n'),
        },
      ],
      temperature: 0,
      max_tokens: 2600,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    },
  );
  const content = response.data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Agent reranker returned an empty result');
  const parsed = parseJsonObject(content) as { selectedIds?: unknown };
  const selectedIds = Array.isArray(parsed.selectedIds)
    ? parsed.selectedIds.filter((id): id is string => typeof id === 'string').slice(0, limit)
    : [];
  const byId = new Map(input.candidates.map(item => [item.id, item]));
  const selected = selectedIds.map(id => byId.get(id)).filter((item): item is KnowledgeSnippet => Boolean(item));
  if (!selected.length) throw new Error('Agent reranker did not select valid evidence');
  return selected;
}

export async function testAgentModelConnection(config: AgentModelConfig): Promise<void> {
  const endpoint = completionEndpoint(config.baseUrl);
  const response = await axios.post<ZhipuResponse>(
    endpoint,
    {
      model: config.model,
      messages: [{ role: 'user', content: '只回复：连接成功' }],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );
  const message = response.data.choices?.[0]?.message;
  if (!message?.content?.trim() && !message?.reasoning_content?.trim()) {
    throw new Error('模型返回为空，请检查 API Key 或中转站状态');
  }
}

export async function fetchAvailableAgentModels(
  apiKey: string,
  baseUrl = AGENT_MODEL_BASE_URL,
): Promise<string[]> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error('请先输入 API Key');
  const response = await axios.get<ModelsResponse>(
    modelsEndpoint(baseUrl),
    {
      headers: { Authorization: `Bearer ${normalizedKey}` },
      timeout: 20000,
    },
  );
  return (response.data.data ?? [])
    .map(item => item.id?.trim())
    .filter((model): model is string => Boolean(model))
    .filter(model => !/(image|audio|realtime|transcri|speech|tts)/i.test(model))
    .sort((a, b) => modelRank(a) - modelRank(b) || a.localeCompare(b));
}

async function resolveModelConfig(): Promise<ResolvedModelConfig | null> {
  const localConfig = await loadAgentModelConfig();
  if (hasUsableAgentModelConfig(localConfig)) {
    return {
      apiKey: localConfig.apiKey,
      baseUrl: localConfig.baseUrl,
      model: localConfig.model,
      provider: providerForModel(localConfig.model),
    };
  }

  const envApiKey = (LLM_API_KEY || ZHIPU_API_KEY)?.trim();
  if (!envApiKey) return null;
  if (LLM_API_KEY?.trim()) {
    const baseUrl = (LLM_API_BASE_URL || '').trim();
    return {
      apiKey: envApiKey,
      baseUrl,
      model: LLM_MODEL || 'GLM-5',
      provider: baseUrl.includes('api.kimi.com') ? 'kimi' : 'glm5',
    };
  }
  return {
    apiKey: envApiKey,
    baseUrl: ZHIPU_ENDPOINT,
    model: ZHIPU_MODEL || 'glm-4.7-flash',
    provider: 'zhipu',
  };
}

function providerForModel(model: string): ResolvedModelConfig['provider'] {
  if (/^(k3|kimi)/i.test(model)) return 'kimi';
  if (/^glm/i.test(model)) return 'glm5';
  if (/^deepseek/i.test(model)) return 'deepseek';
  return 'gateway';
}

function modelRank(model: string): number {
  if (/^(k3|kimi)/i.test(model)) return 0;
  if (/^glm/i.test(model)) return 1;
  if (/^LongCat/i.test(model)) return 2;
  if (/^gpt/i.test(model)) return 3;
  return 4;
}

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  if (!normalized.startsWith('https://')) {
    throw new Error('Narration model endpoint is invalid');
  }
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

function modelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('https://')) {
    throw new Error('模型服务地址必须使用 HTTPS');
  }
  const apiRoot = normalized.endsWith('/chat/completions')
    ? normalized.slice(0, -'/chat/completions'.length)
    : normalized;
  return `${apiRoot}/models`;
}

function cleanNarration(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJsonObject(text: string): unknown {
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Agent planner did not return JSON');
  return JSON.parse(unfenced.slice(start, end + 1));
}

export function parseAgentExecutionPlan(value: unknown): AgentExecutionPlan {
  if (!value || typeof value !== 'object') throw new Error('Agent planner returned an invalid plan');
  const candidate = value as Partial<AgentExecutionPlan>;
  const allowedTools = new Set<AgentExecutionPlan['tools'][number]>([
    'analyze_state',
    'search_knowledge',
    'run_simulation',
    'review_safety',
    'aaps_record_carbs',
    'aaps_read_state',
    'aaps_read_history',
    'aaps_read_profile',
    'aaps_read_pump_status',
    'aaps_bolus',
    'aaps_temp_basal_absolute',
    'aaps_temp_basal_percent',
    'aaps_cancel_temp_basal',
    'aaps_get_operation_status',
  ]);
  const searchQueries = Array.isArray(candidate.searchQueries)
    ? candidate.searchQueries
        .filter(item => item && typeof item.purpose === 'string' && typeof item.query === 'string')
        .map(item => ({ purpose: item.purpose.trim(), query: item.query.trim() }))
        .filter(item => item.query.length >= 2)
        .slice(0, 4)
    : [];
  if (!searchQueries.length) throw new Error('Agent planner did not create search queries');
  const tools = Array.isArray(candidate.tools)
    ? candidate.tools.filter((tool): tool is AgentExecutionPlan['tools'][number] => allowedTools.has(tool))
    : [];
  if (!tools.includes('search_knowledge')) tools.push('search_knowledge');
  const toolCalls = Array.isArray(candidate.toolCalls)
    ? candidate.toolCalls
        .filter(call => call && typeof call === 'object')
        .map(call => call as Partial<AgentExecutionPlan['toolCalls'][number]>)
        .filter((call): call is AgentExecutionPlan['toolCalls'][number] =>
          typeof call.id === 'string'
          && call.id.trim().length > 0
          && typeof call.name === 'string'
          && allowedTools.has(call.name as AgentExecutionPlan['tools'][number])
          && call.name.startsWith('aaps_')
          && Boolean(call.arguments)
          && typeof call.arguments === 'object'
          && !Array.isArray(call.arguments),
        )
        .map(call => ({
          id: call.id.trim(),
          name: call.name,
          arguments: call.arguments,
        }))
        .slice(0, 8)
    : [];
  return {
    objective: typeof candidate.objective === 'string' && candidate.objective.trim()
      ? candidate.objective.trim()
      : '回答用户问题',
    searchQueries,
    tools: [...new Set(tools)],
    toolCalls,
    recommendationFocus: Array.isArray(candidate.recommendationFocus)
      ? candidate.recommendationFocus.filter(item => typeof item === 'string').slice(0, 6)
      : [],
    planner: 'model',
  };
}
