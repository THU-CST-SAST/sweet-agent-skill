import type { DeviceStatus, GlucoseEntry, Profile, TreatmentEntry } from '../types';
import { activeSafetyMessages, approvedHypoCarbsG } from './expertRules';
import { searchKnowledge, searchKnowledgeCandidates } from './knowledge';
import { generateDeterministicNarrative } from './reportGenerator';
import { buildAgentState } from './stateBuilder';
import { routeAgentTask } from './taskRouter';
import type {
  AgentAnswer as BaseAgentAnswer,
  AgentConversationMessage,
  AgentExecutionPlan,
  AgentTaskRoute,
  AgentWorkflowStep,
  ExpertRuleSet,
} from './types';
import {
  isZhipuConfigured,
  narrateWithZhipu,
  narrationProvider,
  planAgentTaskWithModel,
  rerankKnowledgeWithModel,
  describeAgentModelError,
  interpretAgentTurn,
} from './zhipuProvider';
import { buildPatientDecisionState } from './patientDecisionState';
import { retrieveDecisionEvidence } from './decisionEvidence';
import {
  buildAapsToolSelection,
  buildFallbackAapsToolCalls,
  executeAapsToolCalls,
  summarizeAapsToolResults,
  type AapsToolCall,
  type AapsToolProvider,
  type AapsToolResult,
} from './aapsTools';
import { isHistoryReadRequest, requestedHistoryMinutes, isExplicitReadOnly } from './historyReadRequest';
import { resolveDirectRequest, formatDirectResult } from './directRequest';
import {needsTaskPlanning} from './workflowPolicy';
import {currentConversation, type ConversationState, type TurnInterpretation} from './conversationState';
import {isActionConversation,mergeActionDraft,prepareActionDraft,numberText} from './actionConversation';
import {
  buildSimulationNarrative,
  runIntegratedSimulation,
} from './simulationClient';

type AgentAnswer = BaseAgentAnswer & {session?: ConversationState};

export async function answerAgentQuery(input: {
  query: string;
  entries: GlucoseEntry[];
  treatments: TreatmentEntry[];
  profile?: Profile | null;
  deviceStatus?: DeviceStatus | null;
  rules: ExpertRuleSet;
  forcedRoute?: AgentTaskRoute;
  conversationHistory?: AgentConversationMessage[];
  onProgress?: (steps: AgentWorkflowStep[]) => void;
  now?: Date;
  aapsProvider?: AapsToolProvider | null;
  confirmedAapsCallIds?: ReadonlySet<string>;
  session?: ConversationState;
  onToolCalls?: (calls: AapsToolCall[]) => void;
}): Promise<AgentAnswer> {
  const workflow: AgentWorkflowStep[] = [];
  const record = (step: AgentWorkflowStep) => {
    const existing = workflow.findIndex(item => item.id === step.id);
    if (existing >= 0) workflow[existing] = step;
    else workflow.push(step);
    input.onProgress?.(workflow.map(item => ({ ...item })));
  };
  const now = input.now ?? new Date();
  const session = currentConversation(input.session, now);
  const modelConfigured = await isZhipuConfigured();
  let turn:TurnInterpretation|undefined;
  if(modelConfigured && typeof interpretAgentTurn === 'function' && !input.forcedRoute){
    record({id:'route',label:'理解对话',status:'running',detail:'结合已有任务理解本轮意图与参数，不重新规划已明确的操作'});
    try{turn=await interpretAgentTurn({query:input.query,history:input.conversationHistory,session});}
    catch{record({id:'route',label:'理解对话',status:'failed',detail:'语义理解暂不可用；保留会话参数，不猜测或发送操作'});}
  }
  const route = routeAgentTask(input.query, input.forcedRoute ?? (turn?.kind==='analysis'?turn.route:undefined));
  record({
    id: 'route',
    label: '理解任务',
    status: 'completed',
    detail: `识别为“${routeLabel(route)}”任务`,
  });
  const state = buildAgentState({
    route,
    entries: input.entries,
    treatments: input.treatments,
    now,
    rangeStart: route === 'weekly_report'
      ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      : undefined,
  });
  const getProvider=async()=>input.aapsProvider;
  if(session && (/^(?:算了|取消|不做了|先不操作)[。！!\s]*$/.test(input.query)||turn?.kind==='cancel')){
    record({id:'response',label:'取消任务',status:'completed',detail:'取消未提交的会话任务；未向设备发送停止或治疗命令'});
    return {route,state,sources:[],provider:'deterministic',workflow,text:'已取消本次未提交任务，已清除待补参数。没有向设备发送命令。'};
  }
  const normalized=numberText(input.query);
  let direct = !input.forcedRoute || input.forcedRoute === 'rag_qa'
    ? resolveDirectRequest(normalized) : null;
  const continuing = turn ? turn.continuation : session?.kind==='action'&&isActionConversation(input.query,session.action);
  const actionTurn = turn?.kind==='action' || (!turn && isActionConversation(input.query,continuing?session?.action:undefined));
  if(actionTurn){
    const draft=mergeActionDraft(input.query,continuing?session?.action:undefined,turn?.action??null,now);
    if(draft){
      record({id:'route',label:'理解操作',status:'completed',detail:'继承已知参数，仅处理本轮补充；不重新生成治疗方案'});
      record({id:'safety',label:'参数与设备核对',status:'running',detail:'核对参数、参照值、目标设备和必要读数'});
      const prepared=await prepareActionDraft(draft,await getProvider()??null,now);
      if(prepared.call)input.onToolCalls?.([prepared.call]);
      record({id:'safety',label:'参数与设备核对',status:prepared.call?'completed':'skipped',detail:prepared.call?'参数及目标设备已核对，尚未执行':prepared.text});
      record({id:'response',label:prepared.call?'等待用户确认':'补全任务',status:'completed',detail:'保留上下文与已知参数，不重复询问已经提供的字段'});
      return {route,state,sources:[],provider:'deterministic',workflow,text:prepared.text,
        session:{kind:'action',action:prepared.draft,updatedAt:now.toISOString()},
        ...(prepared.call?{aapsAction:{call:prepared.call,command:prepared.description,status:'requires_user_confirmation' as const}}:{})};
    }
  }
  if(turn?.kind==='knowledge'||turn?.kind==='analysis')direct=null;
  // Short query follow-ups update the query window, not a new knowledge-search task.
  const queryContinuation=session?.kind==='query' && (turn?.continuation===true || (!turn && /^(?:那|改成|换成|最近|过去|持续|查)?\s*[\d零一二两三四五六七八九十百]+\s*(?:天|日|周|小时|分钟)[。！!\s]*$/.test(input.query)));
  const queryTool=turn?.kind==='query'?(turn.queryTool??(queryContinuation?session?.query?.tool:undefined)):queryContinuation?session?.query?.tool:undefined;
  if(queryTool){
    const timeText=numberText(turn?.timeEvidence??input.query);
    const timeFragment=timeText.match(/\d+(?:\.\d+)?\s*(?:天|日|周|小时|分钟)/)?.[0];
    const minutes=requestedHistoryMinutes(timeText)??(timeFragment?requestedHistoryMinutes(`最近${timeFragment}`):undefined)??(queryContinuation?session?.query?.historyMinutes:undefined)??1440;
    if(queryTool==='aaps_read_history')direct=/昨天|前天|上周|上个月|\d{4}[-/]\d/.test(timeText)
      ?{kind:'reply',text:'请求指定了历史日期，不能用截至现在的中转站窗口代替。请明确起止时间，以便使用 NS 历史查询。'}
      :resolveDirectRequest(`读取最近${minutes}分钟的治疗记录`);
    else if(queryTool==='aaps_get_operation_status'){
      const operationId=turn?.operationIdEvidence??(queryContinuation?session?.query?.operationId:undefined);
      direct=operationId?{kind:'read',call:{id:'query-receipt',name:queryTool,arguments:{operationId}}}:{kind:'reply',text:'请提供要查询的命令 ID；不会重新发送原动作。'};
    }else direct={kind:'read',call:{id:`query-${queryTool}`,name:queryTool,arguments:{}}};
  }
  if(session?.kind==='action'&&!turn&&!actionTurn&&!direct&&!/什么|为什么|如何|怎么|换个话题|另一个问题|分析|建议|周报|日报|读取|查询/.test(input.query)){
    record({id:'response',label:'澄清本轮补充',status:'completed',detail:'保留未完成任务，没有重建计划或执行命令'});
    return {route,state,sources:[],provider:'deterministic',workflow,session,text:'已保留上一条操作及其参数，但这句补充的含义还不明确。请说明要修改哪个参数；若不继续，可说“取消”。没有发送命令。'};
  }
  if (direct) {
    record({id: 'route', label: '理解任务', status: 'completed', detail: direct.kind === 'read' ? '直接查询，不需要模型规划' : '直接回复'});
    let text = direct.kind === 'reply' ? direct.text : '';
    if(direct.kind==='action')return {route,state,sources:[],provider:'deterministic',workflow,text:'操作意图尚未核实，未生成命令。请明确要操作的设备参数。'};
    if (direct.kind === 'read') {
      input.onToolCalls?.([direct.call]);
      record({id: 'data', label: '读取数据', status: 'running', detail: `调用 ${direct.call.name}`});
      const provider = input.aapsProvider;
      const result = provider ? (await executeAapsToolCalls([direct.call], provider))[0] : {
        tool: direct.call.name, summary: '读取工具未配置', executionStatus: 'failed' as const,
      };
      text = formatDirectResult(result, direct.call);
      record({id: 'data', label: '读取数据', status: result.executionStatus === 'completed' ? 'completed' : 'failed', detail: `${direct.call.name}：${result.summary}`});
    }
    record({id: 'response', label: '展示结果', status: 'completed', detail: '保留语义理解结果，直接展示工具数据；无需额外规划或仿真'});
    return {route, state, sources: [], text, provider: 'deterministic', workflow,
      ...(direct.kind==='read'?{session:{kind:'query' as const,updatedAt:now.toISOString(),query:{tool:direct.call.name as NonNullable<ConversationState['query']>['tool'],historyMinutes:direct.call.arguments.historyMinutes as number|undefined,operationId:direct.call.arguments.operationId as string|undefined}}}:{})};
  }
  record({
    id: 'data',
    label: '读取数据',
    status: 'completed',
    detail: `${input.entries.length} 条血糖、${input.treatments.length} 条治疗记录${input.profile ? '，已读取 Profile' : '，缺少 Profile'}`,
  });
  const isAssistantIntro = route === 'rag_qa' && isAssistantIntroQuery(input.query);
  const decisionState = route === 'current_state'
    ? buildPatientDecisionState({
        entries: input.entries,
        treatments: input.treatments,
        profile: input.profile ?? null,
        deviceStatus: input.deviceStatus ?? null,
        patient: { approvedHypoCarbsG: approvedHypoCarbsG(input.rules) ?? undefined },
      })
    : undefined;
  record({
    id: 'analysis',
    label: '状态分析',
    status: 'completed',
    detail: route === 'rag_qa'
      ? '无需计算患者状态，保留问题上下文'
      : `已计算趋势、覆盖率和风险标记；数据质量 ${state.dataQuality.status}`,
  });
  const requiresPlanning = needsTaskPlanning(input.query, route);
  record({
    id: 'planning',
    label: '制定计划',
    status: requiresPlanning ? 'running' : 'skipped',
    detail: requiresPlanning ? 'Agent 正在决定检索主题和需要调用的工具' : '知识问答直接检索，不调用独立规划模型',
  });
  let executionPlan: AgentExecutionPlan;
  if (modelConfigured && requiresPlanning) {
    try {
      executionPlan = await planAgentTaskWithModel({
        route,
        query: input.query,
        state,
        conversationHistory: input.conversationHistory,
      });
    } catch (error) {
      console.warn('[Agent] model planning failed; using bounded fallback plan', describeAgentModelError?.(error));
      executionPlan = fallbackExecutionPlan(route, input.query, state);
    }
  } else {
    executionPlan = fallbackExecutionPlan(route, input.query, state);
  }
  const requestedAapsTools = requiresPlanning ? buildAapsToolSelection(input.query, route) : [];
  executionPlan = {
    ...executionPlan,
    tools: [...new Set([...executionPlan.tools, ...requestedAapsTools])],
  };
  record({
    id: 'planning',
    label: '制定计划',
    status: requiresPlanning ? 'completed' : 'skipped',
    detail: requiresPlanning ? `${executionPlan.planner === 'model' ? '模型规划' : '本地兜底规划'}：${executionPlan.searchQueries.length} 个检索任务，工具 ${executionPlan.tools.join('、')}` : '知识问答：检索资料后直接回答',
  });
  const plannedAapsCalls = executionPlan.toolCalls.filter(call => !isExplicitReadOnly(input.query)
    || call.name.startsWith('aaps_read_') || call.name === 'aaps_get_operation_status');
  const fallbackAapsTools = requestedAapsTools.filter(tool => executionPlan.tools.includes(tool));
  const aapsCalls = plannedAapsCalls.length
    ? plannedAapsCalls
    : buildFallbackAapsToolCalls(input.query, fallbackAapsTools);
  if (requestedAapsTools.includes('aaps_read_history')
    && !aapsCalls.some(call => call.name === 'aaps_read_history')) {
    aapsCalls.push(...buildFallbackAapsToolCalls(input.query, ['aaps_read_history']));
  }
  const historyMinutes = requestedHistoryMinutes(input.query);
  for (const call of aapsCalls) {
    if (call.name === 'aaps_read_history' && historyMinutes !== undefined) {
      call.arguments = { ...call.arguments, historyMinutes };
    }
  }
  executionPlan = { ...executionPlan, toolCalls: aapsCalls };
  input.onToolCalls?.(aapsCalls);
  let aapsResults: AapsToolResult[] = [];
  if (aapsCalls.length) {
    record({
      id: 'data',
      label: '读取数据',
      status: 'running',
      detail: `Agent 正在调用 AAPS 工具：${aapsCalls.map(call => call.name).join('、')}`,
    });
    const provider = input.aapsProvider;
    aapsResults = provider
      ? await executeAapsToolCalls(aapsCalls, provider, input.confirmedAapsCallIds)
      : aapsCalls.map(call => ({
          callId: call.id,
          tool: call.name,
          summary: 'AAPS Agent 工具运行时不可用，工具没有执行。',
          executionStatus: 'failed' as const,
          executed: false,
        }));
    record({
      id: 'data',
      label: '读取数据',
      status: aapsResults.some(result => result.executionStatus === 'failed') ? 'failed' : 'completed',
      detail: aapsResults.map(result => `${result.tool}：${result.summary}`).join('\n'),
    });
  }
  record({
    id: 'retrieval',
    label: '检索依据',
    status: 'running',
    detail: `正在执行 ${executionPlan.searchQueries.length} 路宽召回`,
  });
  const retrievalCandidates = uniqueSources(executionPlan.searchQueries.flatMap(item =>
    searchKnowledgeCandidates(item.query, 12),
  )).slice(0, 24);
  let plannedSources: ReturnType<typeof searchKnowledgeCandidates>;
  if (modelConfigured && requiresPlanning && retrievalCandidates.length) {
    try {
      plannedSources = await rerankKnowledgeWithModel({
        query: input.query,
        plan: executionPlan,
        candidates: retrievalCandidates,
        limit: 6,
      });
    } catch (error) {
      console.warn('[Agent] semantic reranking failed; using lexical ranking', describeAgentModelError?.(error));
      plannedSources = retrievalCandidates.slice(0, 6);
    }
  } else {
    plannedSources = retrievalCandidates.slice(0, 6);
  }
  let sources = (isAssistantIntro
    ? plannedSources.filter(source => source.sourceType === 'app_help')
    : plannedSources
  ).slice(0, 4);
  let base = route === 'rag_qa'
    ? isAssistantIntro
      ? '我是守糖卫士的血糖洞察助手。我可以回答已审核知识库中的问题、检查当前血糖状态，并生成日报和周报；所有趋势和统计指标都由本地确定性代码计算。'
      : ragDraft(input.query, sources)
    : route === 'current_state' && decisionState
      ? currentDecisionDraft(decisionState)
      : generateDeterministicNarrative(route, state);

  if (route === 'current_state' && decisionState) {
    const baselineEvidence = retrieveDecisionEvidence(decisionState);
    const evidence = {
      ...baselineEvidence,
      approved: uniqueSources([...baselineEvidence.approved, ...plannedSources]),
    };
    sources = evidence.approved.slice(0, 6);
    record({
      id: 'retrieval',
      label: '检索依据',
      status: 'completed',
      detail: `${executionPlan.searchQueries.map(item => item.query).join('；')}；已调用 blood-glucose-management Skill，宽召回 ${retrievalCandidates.length} 条，语义重排保留 ${plannedSources.length} 条`,
    });
    if (input.entries.length >= 18 && input.profile) {
      try {
        record({
          id: 'simulation',
          label: '方案测试',
          status: 'running',
          detail: '正在生成双方案并运行 LoopInsighT1 仿真',
        });
        const simulation = await runIntegratedSimulation({
          entries: input.entries,
          treatments: input.treatments,
          profile: input.profile,
          deviceStatus: input.deviceStatus ?? null,
          approvedHypoCarbsG: approvedHypoCarbsG(input.rules),
          evidence,
        });
        base = `${base}\n\nAgent Loop 仿真分析：\n${buildSimulationNarrative(simulation)}`;
        record({
          id: 'simulation',
          label: '方案测试',
          status: 'completed',
          detail: `已测试 ${simulation.plan.candidateCount} 个方案；结论 ${simulation.finalAction.status}${simulation.finalAction.selectedPlanId ? `，候选 ${simulation.finalAction.selectedPlanId}` : ''}`,
        });
      } catch (error) {
        base = `${base}\n\nAgent Loop 本轮未完成：${error instanceof Error ? error.message : '未知错误'}。以上状态分析仍然有效。`;
        record({
          id: 'simulation',
          label: '方案测试',
          status: 'failed',
          detail: error instanceof Error ? error.message : '仿真发生未知错误',
        });
      }
    } else {
      const missing = [
        input.entries.length < 18 && `至少需要 18 条近期血糖记录（当前 ${input.entries.length} 条）`,
        !input.profile && '缺少治疗 Profile',
      ].filter(Boolean).join('；');
      base = `${base}\n\nAgent Loop 本轮未运行：${missing}。补齐后可在对话中重新分析，或进入“建议与仿真”查看曲线。`;
      record({ id: 'simulation', label: '方案测试', status: 'skipped', detail: missing });
    }
  } else {
    record({
      id: 'retrieval',
      label: '检索依据',
      status: 'completed',
      detail: `${executionPlan.searchQueries.map(item => item.query).join('；')}；已调用 blood-glucose-management Skill，宽召回 ${retrievalCandidates.length} 条，语义重排保留 ${sources.length} 条`,
    });
    record({
      id: 'simulation',
      label: '方案测试',
      status: 'skipped',
      detail: route === 'rag_qa' ? '知识问答不运行治疗仿真' : '报告任务不生成治疗方案',
    });
  }
  // Knowledge-only answers must not inherit warnings from an empty glucose
  // snapshot. Safety messages are relevant only when we are analysing data.
  const safety = route === 'rag_qa' ? [] : activeSafetyMessages(state, input.rules);
  record({
    id: 'safety',
    label: '安全复核',
    status: 'completed',
    detail: safety.length ? `触发 ${safety.length} 条安全提示` : '未触发额外安全提示',
  });
  const aapsToolDraft = summarizeAapsToolResults(aapsResults);
  const historyOnly = route === 'rag_qa' && isHistoryReadRequest(input.query);
  const deterministicDraft = (historyOnly ? [aapsToolDraft] : [aapsToolDraft, ...safety, base]).filter(Boolean).join('\n\n');
  const pendingResult = aapsResults.find(result =>
    result.executionStatus === 'requires_user_confirmation' && result.callId,
  );
  const pendingCall = pendingResult
    ? aapsCalls.find(call => call.id === pendingResult.callId)
    : undefined;
  const aapsAction = pendingCall
    ? {
        call: pendingCall,
        command: describeAapsToolCall(pendingCall),
        status: 'requires_user_confirmation' as const,
      }
    : undefined;

  if (!modelConfigured) {
    record({ id: 'response', label: '组织回答', status: 'skipped', detail: '未配置模型，使用本地确定性结果' });
    return {
      route,
      state,
      sources,
      text: deterministicDraft,
      provider: 'deterministic',
      workflow,
      aapsAction,
    };
  }

  try {
    record({ id: 'response', label: '组织回答', status: 'running', detail: '模型正在结合数据、依据和测试结果生成完整回复' });
    const text = await narrateWithZhipu({
      route,
      query: input.query,
      state,
      deterministicDraft,
      sources,
      rules: input.rules,
      decisionState,
      conversationHistory: input.conversationHistory,
      executionPlan,
    });
    record({ id: 'response', label: '组织回答', status: 'completed', detail: '已完成回答并保留确定性数值' });
    return { route, state, sources, text, provider: await narrationProvider(), workflow, aapsAction };
  } catch (error) {
    console.warn('[Agent] model request failed; using deterministic fallback', describeAgentModelError?.(error));
    record({
      id: 'response',
      label: '组织回答',
      status: 'failed',
      detail: `${describeAgentModelError(error)}，已切换到本地确定性结果`,
    });
    return {
      route,
      state,
      sources,
      text: `${deterministicDraft}\n\n（模型服务暂不可用，以上为确定性分析结果。）`,
      provider: 'fallback',
      workflow,
      aapsAction,
    };
  }
}

export async function executeConfirmedAapsToolCall(
  call: AapsToolCall,
  provider?: AapsToolProvider | null,
): Promise<AapsToolResult> {
  const resolvedProvider = provider;
  if (!resolvedProvider) {
    return {
      callId: call.id,
      tool: call.name,
      summary: 'AAPS Agent 工具运行时不可用，操作没有执行。',
      executionStatus: 'failed',
      executed: false,
    };
  }
  if (call.arguments.expectedDeviceId) {
    try {
      const status=await resolvedProvider.invoke({id:`${call.id}:preflight`,name:'aaps_read_pump_status',arguments:{requireRelay:true}});
      const seen=Date.parse(String(status.data?.last_seen??''));
      if(status.status!=='succeeded'||status.data?.source!=='aaps_relay'||status.data?.device_id!==call.arguments.expectedDeviceId
        ||status.data?.offline===true||!Number.isFinite(seen)||Date.now()-seen>5*60000||seen>Date.now()+60000
        ||(call.name!=='aaps_record_carbs'&&status.data?.pump_connected!==true)){
        return {tool:call.name,callId:call.id,executed:false,executionStatus:'failed',summary:'确认时目标设备状态已变化或无法核验，未发送治疗命令，请重新核对。'};
      }
    }catch{return {tool:call.name,callId:call.id,executed:false,executionStatus:'failed',summary:'确认时设备状态核对失败，未发送治疗命令。'};}
  }
  return (await executeAapsToolCalls([call], resolvedProvider, new Set([call.id])))[0];
}

function describeAapsToolCall(call: AapsToolCall): string {
  return `${call.name} ${JSON.stringify(call.arguments)}`;
}

function fallbackExecutionPlan(
  route: AgentTaskRoute,
  query: string,
  state: ReturnType<typeof buildAgentState>,
): AgentExecutionPlan {
  const searchQueries: AgentExecutionPlan['searchQueries'] = route === 'rag_qa'
    ? isAssistantIntroQuery(query)
      ? [
          { purpose: '说明 Agent 能力', query: '血糖洞察助手 Agent 能做什么' },
          { purpose: '说明 Agent 工作方式', query: 'Agent Loop 知识检索 状态分析 仿真' },
        ]
      : [
          { purpose: '回答用户问题', query },
          { purpose: '补充审核依据', query: `${query} 血糖管理 指南` },
        ]
    : route === 'current_state'
      ? [
          { purpose: '评估当前趋势', query: '当前血糖趋势 IOB COB 低血糖 高血糖 风险' },
          { purpose: '评估复测与处置', query: 'CGM 趋势 复测 活性胰岛素 安全处置' },
        ]
      : reportSearchQueries(state);
  return {
    objective: route === 'weekly_report'
      ? '分析一周模式并生成有依据的后续建议'
      : route === 'daily_report'
        ? '复盘当日数据并生成有依据的后续建议'
        : route === 'current_state'
          ? '分析当前状态并用仿真测试候选方案'
          : '检索审核资料后回答用户问题',
    searchQueries,
    tools: route === 'current_state'
      ? ['analyze_state', 'search_knowledge', 'run_simulation', 'review_safety']
      : route === 'rag_qa'
        ? ['search_knowledge']
        : ['analyze_state', 'search_knowledge', 'review_safety'],
    toolCalls: [],
    recommendationFocus: route === 'rag_qa'
      ? ['直接回答问题', '标明资料边界']
      : ['数据异常模式', '可复核的下一步', '不绕过安全门'],
    planner: 'fallback',
  };
}

function reportSearchQueries(
  state: ReturnType<typeof buildAgentState>,
): AgentExecutionPlan['searchQueries'] {
  const result: AgentExecutionPlan['searchQueries'] = [
    { purpose: '解释核心指标', query: 'TIR TBR TAR CV 血糖复盘 指标解释' },
  ];
  if ((state.glucose.tbrPercent ?? 0) > 4) {
    result.push({ purpose: '复盘低血糖', query: '低血糖时段 IOB 运动 夜间 复盘' });
  }
  if ((state.glucose.tarPercent ?? 0) > 25) {
    result.push({ purpose: '复盘高血糖', query: '餐后高血糖 夜间高血糖 碳水 胰岛素 复盘' });
  }
  if ((state.glucose.cvPercent ?? 0) >= 36) {
    result.push({ purpose: '复盘波动', query: '血糖变异系数 CV 波动 进食 运动 复盘' });
  }
  if (result.length === 1) {
    result.push({ purpose: '形成后续观察计划', query: 'CGM 周报 血糖模式 后续观察 建议' });
  }
  return result.slice(0, 4);
}

function routeLabel(route: AgentTaskRoute): string {
  return ({
    rag_qa: '知识问答',
    current_state: '当前状态分析',
    daily_report: '日报',
    weekly_report: '周报',
  })[route];
}

function uniqueSources<T extends { sourceRef: string }>(sources: T[]): T[] {
  return sources.filter((source, index) =>
    sources.findIndex(candidate => candidate.sourceRef === source.sourceRef) === index,
  );
}

function currentDecisionDraft(
  state: ReturnType<typeof buildPatientDecisionState>,
): string {
  const lines = [
    `当前血糖 ${display(state.glucose.currentMgdl)} mg/dL，30 分钟斜率 ${display(state.glucose.slope30Min)} mg/dL/min，确定性趋势为 ${state.glucose.trend}。`,
    `实时治疗状态：IOB ${display(state.insulin.iobU)} U，COB ${display(state.carbs.cobG)} g，当前基础率 ${display(state.insulin.activeBasalUph)} U/h。`,
    `AAPS/Loop 预测血糖：${display(state.algorithm.eventualBgMgdl)} mg/dL；本地线性 30 分钟外推：${display(state.glucose.projected30MinMgdl)} mg/dL。`,
    `Profile：ISF ${display(state.therapyProfile.activeIsfMgdlPerU)} mg/dL/U，CR ${display(state.therapyProfile.activeCarbRatioGPerU)} g/U，目标 ${display(state.therapyProfile.targetLowMgdl)}–${display(state.therapyProfile.targetHighMgdl)} mg/dL，DIA ${display(state.therapyProfile.diaHours)} 小时。`,
    `数据质量：${state.dataQuality.status}；缺失或过期项：${state.dataQuality.missingOrStale.join('、') || '无'}。`,
  ];
  const predictedLow = (state.algorithm.eventualBgMgdl ?? Infinity) < 70
    || (state.glucose.projected30MinMgdl ?? Infinity) < 70;
  if (predictedLow || state.riskFlags.includes('active_insulin_with_falling_glucose')) {
    lines.push('确定性风险结论：存在活动胰岛素和/或预测低血糖风险，禁止表述为“低血糖风险低”；任何数值动作必须经过患者协议、仿真与人工审核门禁。');
  }
  lines.push('本轮只做状态解释，不生成可执行胰岛素或补碳剂量。');
  return lines.join('\n\n');
}

function display(value: number | null): string {
  return value === null ? '缺失' : String(value);
}

function isAssistantIntroQuery(query: string): boolean {
  return /^(你好|您好|嗨|hello|hi)[！!。.]?$/i.test(query.trim()) ||
    /(你是谁|你能做什么|介绍.*自己|who are (you|u)|what can you do)/i.test(query);
}

function ragDraft(query: string, sources: ReturnType<typeof searchKnowledge>): string {
  if (!sources.length) {
    return `已审核知识库中暂未检索到与“${query}”直接相关的资料。若这是日常交流、App 使用或对上一轮的追问，模型可以结合对话继续回答；若涉及医疗事实，则必须明确没有审核证据，不能编造来源。`;
  }
  const [primary, ...related] = sources;
  const productHelp = sources.every(source => source.sourceType === 'app_help');
  return [
    `结论：${excerpt(primary.text, query, 220)}`,
    ...(related.length
      ? ['', '补充依据：', ...related.map(source => `• ${excerpt(source.text, query, 120)}`)]
      : []),
    '',
    productHelp
      ? '以上依据来自 App 当前实现；具体数值和可用功能以本次运行状态为准。'
      : '以上是通用知识说明；如果读数与症状不一致，请按既有医疗方案复核。',
  ].join('\n');
}

function excerpt(value: string, query: string, maxLength = 180): string {
  const text = value.replace(/\s+/g, ' ').trim().replace(/^题目[:：]\s*/, '');
  if (text.length <= maxLength) return text;

  const terms = query
    .toLowerCase()
    .replace(/[，。！？、,.!?\s]+/g, '')
    .match(/[a-z0-9]+|[\u4e00-\u9fa5]{2}/g) ?? [];
  const lower = text.toLowerCase();
  const matchAt = terms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, matchAt - 30);
  const prefix = start > 0 ? '…' : '';
  return `${prefix}${text.slice(start, start + maxLength).trim()}…`;
}
