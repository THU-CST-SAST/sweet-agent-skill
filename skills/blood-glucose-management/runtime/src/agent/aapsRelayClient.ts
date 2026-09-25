import axios from 'axios';
import type {
  AapsProviderResult,
  AapsToolCall,
  AapsToolProvider,
} from './aapsTools';

export interface AapsRelayConfig {
  baseUrl: string;
  deviceId: string;
  aiKey: string;
}

interface RelayEnvelope<T> {
  status?: string;
  data?: T;
}

interface RelayCommand {
  command_id?: string;
  cmd?: string;
  status?: string;
}

interface RelayAuditLog {
  command_id?: string;
  action?: string;
  detail?: unknown;
  timestamp?: string;
}

export function validateAapsRelayConfig(config: AapsRelayConfig): void {
  if (config.baseUrl.trim().replace(/\/$/, '') !== 'https://ai-server.phpjxc.com'
    && !config.baseUrl.trim().startsWith('https://')) {
    throw new Error('AAPS 中转站必须使用 HTTPS');
  }
  if (!config.deviceId.trim()) throw new Error('AAPS 中转站设备 ID 不能为空');
  if (!config.aiKey.trim()) throw new Error('AAPS 中转站 AI Key 不能为空');
}

export class AapsRelayClient implements AapsToolProvider {
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly aiKey: string;

  constructor(config: AapsRelayConfig) {
    validateAapsRelayConfig(config);
    this.baseUrl = config.baseUrl.trim().replace(/\/$/, '');
    this.deviceId = config.deviceId.trim();
    this.aiKey = config.aiKey.trim();
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const response = await axios.get<RelayEnvelope<Record<string, unknown>>>(
      `${this.deviceUrl}/status`,
      { headers: this.headers, timeout: 15000, maxRedirects: 0 },
    );
    if (response.data.status !== 'ok' || !isRecord(response.data.data)) {
      throw new Error('AAPS 中转站返回了无效设备状态');
    }
    return response.data.data;
  }

  async invoke(call: AapsToolCall): Promise<AapsProviderResult> {
    if(call.name==='aaps_read_pump_status'){
      const data=await this.testConnection();
      if(data.device_id!==this.deviceId)throw Error('Relay returned a different device');
      return {status:'succeeded',summary:'Read target device status from relay',data:{...data,source:'aaps_relay'}};
    }
    if (call.name === 'aaps_read_history') return this.readTreatments(call);
    if (call.name === 'aaps_get_operation_status') {
      return this.readOperationStatus(call.arguments.operationId);
    }
    const cmd = commandForToolCall(call);
    if(call.arguments.expectedDeviceId!==undefined&&call.arguments.expectedDeviceId!==this.deviceId)throw Error('Target device changed; confirm again');
    const confidence = numberArgument(call.arguments.confidence, 1);
    const reason = stringArgument(call.arguments.reason)
      || `用户确认 Agent 执行 ${cmd}`;
    const response = await axios.post<RelayEnvelope<RelayCommand>>(
      `${this.deviceUrl}/commands`,
      { cmd, reason, confidence, skip_safety: false },
      { headers: { ...this.headers, 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 0 },
    );
    const command = response.data.data;
    if (response.status !== 201 || response.data.status !== 'ok' || !command?.command_id) {
      throw new Error('AAPS 中转站未创建命令');
    }
    return {
      status: 'pending',
      operationId: command.command_id,
      summary: `中转站已接收 ${command.cmd ?? cmd}，等待设备执行回执。`,
      data: { commandId: command.command_id, relayStatus: command.status ?? 'approved' },
    };
  }

  private async readOperationStatus(operationId: unknown): Promise<AapsProviderResult> {
    if (typeof operationId !== 'string' || !operationId.trim()) {
      throw new Error('缺少中转站命令 ID');
    }
    const response = await axios.get<RelayEnvelope<{ logs?: RelayAuditLog[] }>>(
      `${this.deviceUrl}/audit`,
      {
        headers: this.headers,
        params: { hours: 24, limit: 100 },
        timeout: 15000,
        maxRedirects: 0,
      },
    );
    const logs = response.data.data?.logs?.filter(log => log.command_id === operationId) ?? [];
    const terminal = logs.filter(log => ['executed', 'failed', 'error', 'rejected'].includes(log.action ?? '')).sort((a,b)=>Date.parse(b.timestamp??'')-Date.parse(a.timestamp??''))[0];
    if (!terminal) {
      return {
        status: 'pending',
        operationId,
        summary: '命令仍在等待设备执行回执。',
      };
    }
    const failed = ['failed', 'error', 'rejected'].includes(terminal.action ?? '');
    const data = parseAuditDetail(terminal.detail);
    return {
      status: failed ? 'failed' : 'succeeded',
      operationId,
      summary: failed ? '设备报告命令执行失败。' : '设备已执行命令并返回结果。',
      data,
      ...(failed ? { errorCode: terminal.action } : {}),
    };
  }

  private async readTreatments(call: AapsToolCall): Promise<AapsProviderResult> {
    const minutes = call.arguments.historyMinutes ?? 1440;
    const limit = call.arguments.limit ?? 500;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1
      || minutes > 43200 || typeof limit !== 'number' || !Number.isInteger(limit)
      || limit < 1 || limit > 1000) throw new Error('Invalid treatment history window or limit');
    const response = await axios.get<RelayEnvelope<Record<string, unknown>>>(
      `${this.deviceUrl}/treatments`,
      {headers: this.headers, params: {hours: Math.ceil(minutes / 60), limit}, timeout: 15000, maxRedirects: 0},
    );
    const data = response.data.data;
    if (response.data.status !== 'ok' || !isRecord(data) || !Array.isArray(data.treatments)
      || data.device_id !== this.deviceId || !data.treatments.every(isRecord)) {
      throw new Error('Invalid relay treatment history or mismatched device ID');
    }
    return {status: 'succeeded',
      summary: `Read ${data.treatments.length} relay-visible treatments; this is not guaranteed to cover all AAPS treatments.`,
      data: {...data, source: 'aaps_relay', fetchedAt: new Date().toISOString(),
        requestedHistoryMinutes: minutes, queriedHours: Math.ceil(minutes / 60),
        possiblyTruncated: data.treatments.length >= limit, coverage: 'relay_visible_history_only'},
    };
  }

  private get deviceUrl(): string {
    return `${this.baseUrl}/api/v1/device/${encodeURIComponent(this.deviceId)}`;
  }

  private get headers(): { 'X-AI-Key': string } {
    return { 'X-AI-Key': this.aiKey };
  }
}

function commandForToolCall(call: AapsToolCall): string {
  switch (call.name) {
    case 'aaps_record_carbs':
      return `CARBS ${positiveNumber(call.arguments.carbsG, '碳水克数')}`;
    case 'aaps_bolus':
      return `BOLUS ${positiveNumber(call.arguments.insulinU, '大剂量')}`;
    case 'aaps_temp_basal_absolute':
      return `BASAL ${nonNegativeNumber(call.arguments.rateUph, '基础率')} ${positiveInteger(call.arguments.durationMinutes, '持续时间')}`;
    case 'aaps_temp_basal_percent':
      return `BASAL ${nonNegativeNumber(call.arguments.percent, '基础率百分比')} ${positiveInteger(call.arguments.durationMinutes, '持续时间')}`;
    case 'aaps_cancel_temp_basal':
      return 'BASAL STOP';
    default:
      throw new Error(`工具 ${call.name} 不是中转站写入操作`);
  }
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = numberArgument(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须大于 0`);
  return parsed;
}

function nonNegativeNumber(value: unknown, label: string): number {
  const parsed = numberArgument(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}不能小于 0`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = positiveNumber(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label}必须是整数分钟`);
  return parsed;
}

function numberArgument(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function stringArgument(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAuditDetail(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return { detail: value };
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : { detail: value };
  } catch {
    return { detail: value };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
