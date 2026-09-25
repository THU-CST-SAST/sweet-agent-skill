import type { AapsToolCall, AapsToolResult } from './aapsTools';
import { isHistoryReadRequest, requestedHistoryMinutes } from './historyReadRequest';
import {resolveDirectActionRequest, type DirectActionRequest} from './directActionRequest';

export type DirectRequest =
  | DirectActionRequest
  | { kind: 'read'; call: AapsToolCall };

export function resolveDirectRequest(query: string): DirectRequest | null {
  const text = query.trim();
  if (/^(?:查询|查看|读取|查一下).*(?:回执|执行结果|操作状态)/.test(text)) {
    const id = text.match(/(?:command_id|operationId|命令ID|操作ID|ID)\s*[=:：]?\s*([A-Za-z0-9_-]+)/i)
      ?? text.match(/\b(cmd_[A-Za-z0-9_-]+)\b/);
    return id ? {kind:'read',call:{id:'direct-receipt',name:'aaps_get_operation_status',arguments:{operationId:id[1]}}}
      : {kind:'reply',text:'请提供要查询的命令 ID，或点击原操作下方的“查询 AAPS 执行状态”。不会重新发送治疗命令。'};
  }
  const action=resolveDirectActionRequest(text);
  if(action)return action;
  if (/^(你好|您好|嗨|hello|hi|谢谢|感谢)[！!。\s]*$/i.test(text)) {
    return { kind: 'reply', text: /谢谢|感谢/.test(text)
      ? '不客气。'
      : '你好，可以直接让我查询治疗记录、血糖读数、IOB、Profile 或泵状态，也可以让我分析数据。' };
  }
  // Clinical interpretation and multi-step tasks still belong to the model workflow.
  if (/分析|解释|为什么|原因|建议|怎么办|是否|能否|安全吗|危险|评估|对比|比较|仿真|周报|日报|报告|调整|帮我打|打针|注射(?!记录)|记录我|录入|设置|取消|停止|analy[sz]e|recommend|why|simulate|inject/i.test(text)) return null;
  if (/(?:不要|别|不用|不想).*(?:查询|读取|查看|列出)|不知道|不确定/.test(text)) return null;
  const targets = [
    isHistoryReadRequest(text),
    /profile|配置档案|基础率配置/i.test(text),
    /泵.*状态|pump.*status/i.test(text),
    /血糖|读数|iob|cob|当前状态|glucose/i.test(text),
  ];
  if (targets.filter(Boolean).length > 1) return null;
  let name: AapsToolCall['name'] | undefined;
  if (targets[0]) name = 'aaps_read_history';
  else if (/读取|查询|查看|显示|查一下|看看|多少|read|show|check|get/i.test(text)) {
    if (/profile|配置档案|基础率配置/i.test(text)) name = 'aaps_read_profile';
    else if (/泵.*状态|pump.*status/i.test(text)) name = 'aaps_read_pump_status';
    else if (/血糖|读数|iob|cob|基础率|当前状态|glucose/i.test(text)) name = 'aaps_read_state';
  }
  if (!name) return null;
  if (name !== 'aaps_read_history' && /指定日期|历史|昨天|前天|上周|\d{4}[-/]\d/.test(text)) return null;
  const minutes = requestedHistoryMinutes(text);
  if (name === 'aaps_read_history') {
    if (/\d{4}[-/]\d|昨天|前天|上个月|上周|去年/.test(text)) {
      return {kind: 'reply', text: '当前中转站接口只支持截至现在的最近一段时间。请指定“最近几天/小时”；历史日期回放需要使用 NS，不能用当前记录代替。'};
    }
    if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200)) {
      return {kind: 'reply', text: '治疗历史查询支持最近 1 分钟至 30 天，请缩小查询范围；没有发送请求。'};
    }
    if (minutes === undefined && /最近|过去|last|past/.test(text)) {
      return {kind: 'reply', text: '请明确查询范围，例如“最近7天”或“最近48小时”，避免读取错误的时间段。'};
    }
  }
  return {kind: 'read', call: {id: `direct-${name}`, name,
    arguments: name === 'aaps_read_history' ? {historyMinutes: minutes ?? 1440} : {}}};
}

export function formatDirectResult(result: AapsToolResult, call: AapsToolCall): string {
  const data = result.data ?? {};
  if (result.executionStatus === 'pending') return `操作仍在等待设备回执：${result.summary}\n命令 ID：${result.operationId ?? '未返回'}。没有重新发送原动作。`;
  if (result.executionStatus !== 'completed') return `读取未完成：${result.summary}`;
  const source = data.source === 'aaps_relay' ? 'AAPS 中转站' : data.source === 'nightscout' ? 'Nightscout' : '工具未标明来源';
  const lines = [`数据来源：${source}`, result.summary];
  if (call.name === 'aaps_read_history') {
    lines.push(`查询范围：最近 ${call.arguments.historyMinutes} 分钟（截至本次查询）`);
    const records = Array.isArray(data.treatments) ? data.treatments : [];
    lines.push(`本次返回记录：${records.length} 条`);
    if (data.fallbackReason) lines.push(`回退原因：${data.fallbackReason}`);
    if (data.possiblyTruncated) lines.push('达到返回条数上限，记录可能不完整。');
    const ordered = [...records].sort((a, b) => {
      const stamp = (r: any) => String(r?.time ?? r?.created_at ?? r?.timestamp ?? '');
      return stamp(b).localeCompare(stamp(a));
    });
    lines.push(...ordered.slice(0, 10).map((r: any, index) => `${index + 1}. ${JSON.stringify(r)}`));
    if (records.length > 10) lines.push('以上展示最近 10 条原始记录，数值、单位及时间保持接口原样。');
    lines.push('仅代表该来源可见记录，不保证覆盖全部治疗；空记录不等于没有治疗。');
  } else {
    // Preserve upstream fields; do not infer units, zero values or current pump rates.
    lines.push(JSON.stringify(data, null, 2));
  }
  return lines.join('\n');
}
