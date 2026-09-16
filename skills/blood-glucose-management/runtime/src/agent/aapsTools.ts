import type { IDataSourceAdapter } from '../types';
import type { AgentTaskRoute } from './types';

export type AapsToolName =
  | 'aaps_record_carbs'
  | 'aaps_read_state'
  | 'aaps_read_history'
  | 'aaps_read_profile'
  | 'aaps_read_pump_status'
  | 'aaps_bolus'
  | 'aaps_temp_basal_absolute'
  | 'aaps_temp_basal_percent'
  | 'aaps_cancel_temp_basal'
  | 'aaps_get_operation_status';

export interface AapsToolCall {
  id: string;
  name: AapsToolName;
  arguments: Record<string, unknown>;
}

export interface AapsProviderResult {
  status: 'pending' | 'succeeded' | 'failed';
  summary?: string;
  data?: Record<string, unknown>;
  errorCode?: string;
  operationId?: string;
}

export interface AapsToolProvider {
  invoke(call: AapsToolCall): Promise<AapsProviderResult>;
}

export interface AapsToolContext {
  now: Date;
  adapter?: Pick<
    IDataSourceAdapter,
    'createTreatment' | 'getTreatments' | 'getCurrentGlucose' | 'getDeviceStatus' | 'getProfile'
  >;
}

export interface AapsToolResult {
  tool: AapsToolName;
  callId?: string;
  summary: string;
  data?: Record<string, unknown>;
  recordedCarbsG?: number;
  verified?: boolean;
  command?: string;
  operationId?: string;
  executionStatus?: 'pending' | 'completed' | 'requires_user_confirmation' | 'skipped' | 'failed';
  executed?: boolean;
}

const AAPS_ACTION_TOOLS = new Set<AapsToolName>([
  'aaps_record_carbs',
  'aaps_bolus',
  'aaps_temp_basal_absolute',
  'aaps_temp_basal_percent',
  'aaps_cancel_temp_basal',
]);

export interface AapsToolExecutionOptions {
  maxPollAttempts?: number;
  pollDelayMs?: number;
}

export async function executeAapsToolCalls(
  calls: AapsToolCall[],
  provider: AapsToolProvider,
  confirmedCallIds: ReadonlySet<string> = new Set(),
  options: AapsToolExecutionOptions = {},
): Promise<AapsToolResult[]> {
  const results: AapsToolResult[] = [];
  for (const call of calls) {
    if (AAPS_ACTION_TOOLS.has(call.name) && !confirmedCallIds.has(call.id)) {
      results.push({
        callId: call.id,
        tool: call.name,
        summary: `工具 ${call.name} 涉及治疗记录或设备操作，等待用户确认。`,
        executionStatus: 'requires_user_confirmation',
        executed: false,
      });
      continue;
    }

    try {
      let providerResult = await provider.invoke(call);
      if (providerResult.status === 'pending' && providerResult.operationId) {
        providerResult = await pollAapsOperation(
          provider,
          call,
          providerResult,
          options,
        );
      }
      const succeeded = providerResult.status === 'succeeded';
      const pending = providerResult.status === 'pending';
      results.push({
        callId: call.id,
        tool: call.name,
        summary: providerResult.summary
          ?? (succeeded
            ? `工具 ${call.name} 执行完成。`
            : pending
              ? `工具 ${call.name} 已进入 AAPS 队列，仍在执行。`
              : `工具 ${call.name} 执行失败。`),
        data: providerResult.data,
        operationId: providerResult.operationId,
        executionStatus: succeeded ? 'completed' : pending ? 'pending' : 'failed',
        executed: succeeded,
      });
    } catch (error) {
      results.push({
        callId: call.id,
        tool: call.name,
        summary: error instanceof Error ? error.message : `工具 ${call.name} 执行失败。`,
        executionStatus: 'failed',
        executed: false,
      });
    }
  }
  return results;
}

async function pollAapsOperation(
  provider: AapsToolProvider,
  originalCall: AapsToolCall,
  initial: AapsProviderResult,
  options: AapsToolExecutionOptions,
): Promise<AapsProviderResult> {
  const maxPollAttempts = options.maxPollAttempts ?? 12;
  const pollDelayMs = options.pollDelayMs ?? 1000;
  let result = initial;
  for (let attempt = 0; attempt < maxPollAttempts && result.status === 'pending'; attempt += 1) {
    if (pollDelayMs > 0) await delay(pollDelayMs);
    result = await provider.invoke({
      id: `${originalCall.id}:status:${attempt + 1}`,
      name: 'aaps_get_operation_status',
      arguments: { operationId: initial.operationId },
    });
  }
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const AAPS_KEYWORDS = /(aaps|loop|泵|基础率|临时基础率|大剂量|胰岛素|碳水|iob|cob|bolus|basal|pump)/i;

export function buildAapsToolSelection(
  query: string,
  route: AgentTaskRoute,
): AapsToolName[] {
  const selection: AapsToolName[] = [];
  if (route !== 'rag_qa' || AAPS_KEYWORDS.test(query)) {
    selection.push('aaps_read_state');
  }
  if (/(记录|录入|吃了|摄入|补碳|碳水).*(碳水|克|g)|碳水.*(记录|录入|吃了)/i.test(query)) {
    if (!selection.includes('aaps_read_state')) selection.push('aaps_read_state');
    selection.push('aaps_record_carbs');
  }
  if (/(?:打|注射|输注|bolus)\s*\d+(?:\.\d+)?/i.test(query)) {
    if (!selection.includes('aaps_read_state')) selection.push('aaps_read_state');
    selection.push('aaps_bolus');
  }
  if (/(?:取消|停止).*(?:临时基础率|temp\s*basal)|(?:临时基础率|temp\s*basal).*(?:取消|停止)/i.test(query)) {
    selection.push('aaps_cancel_temp_basal');
  } else if (/(?:临时基础率|temp\s*basal).*\d+(?:\.\d+)?\s*%/i.test(query)) {
    if (!selection.includes('aaps_read_state')) selection.push('aaps_read_state');
    selection.push('aaps_temp_basal_percent');
  } else if (/(?:临时基础率|temp\s*basal).*\d+(?:\.\d+)?\s*(?:u\/h|U\/h|单位\/小时)/i.test(query)) {
    if (!selection.includes('aaps_read_state')) selection.push('aaps_read_state');
    selection.push('aaps_temp_basal_absolute');
  }
  return [...new Set(selection)];
}

export function buildFallbackAapsToolCalls(
  query: string,
  tools: AapsToolName[],
): AapsToolCall[] {
  return tools.flatMap((name, index) => {
    const base = { id: `fallback-${name}-${index + 1}`, name };
    if (name === 'aaps_read_state') return [{ ...base, arguments: { historyMinutes: 120 } }];
    if (name === 'aaps_read_history') return [{ ...base, arguments: { historyMinutes: 24 * 60 } }];
    if (name === 'aaps_read_profile' || name === 'aaps_read_pump_status') return [{ ...base, arguments: {} }];
    const actionArguments = fallbackActionArguments(name, query);
    return actionArguments ? [{ ...base, arguments: { ...actionArguments, reason: query, confidence: 1 } }] : [];
  });
}

function fallbackActionArguments(name: AapsToolName, query: string): Record<string, unknown> | null {
  if (name === 'aaps_record_carbs') {
    const match = query.match(/(\d+(?:\.\d+)?)\s*(?:克|g)/i);
    return match ? { carbsG: Number(match[1]) } : null;
  }
  if (name === 'aaps_bolus') {
    const match = query.match(/(?:打|注射|输注|bolus)\s*(\d+(?:\.\d+)?)/i);
    return match ? { insulinU: Number(match[1]) } : null;
  }
  if (name === 'aaps_temp_basal_percent') {
    const match = query.match(/(?:临时基础率|temp\s*basal).*?(\d+(?:\.\d+)?)\s*%.*?(\d+)\s*(?:分钟|min)/i);
    return match ? { percent: Number(match[1]), durationMinutes: Number(match[2]) } : null;
  }
  if (name === 'aaps_temp_basal_absolute') {
    const match = query.match(/(?:临时基础率|temp\s*basal).*?(\d+(?:\.\d+)?)\s*(?:u\/h|U\/h|单位\/小时).*?(\d+)\s*(?:分钟|min)/i);
    return match ? { rateUph: Number(match[1]), durationMinutes: Number(match[2]) } : null;
  }
  return name === 'aaps_cancel_temp_basal' ? {} : null;
}

export function summarizeAapsToolResults(results: AapsToolResult[]): string {
  return results.length
    ? `Agent 工具调用：\n${results.map(result =>
        `- ${result.summary}${result.data ? `\n  结构化结果：${JSON.stringify(result.data)}` : ''}`,
      ).join('\n')}`
    : '';
}
