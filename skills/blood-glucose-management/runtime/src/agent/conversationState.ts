import type {ActionDraft, ActionInterpretation} from './actionConversation';

export interface ConversationState {
  kind: 'query' | 'action';
  updatedAt: string;
  action?: ActionDraft;
  query?: {tool: 'aaps_read_history'|'aaps_read_state'|'aaps_read_profile'|'aaps_read_pump_status'|'aaps_get_operation_status'; historyMinutes?: number; operationId?: string};
}

export interface TurnInterpretation {
  kind: 'query'|'action'|'knowledge'|'analysis'|'cancel';
  continuation: boolean;
  route?: 'current_state'|'daily_report'|'weekly_report';
  queryTool?: NonNullable<ConversationState['query']>['tool'];
  action?: ActionInterpretation;
  timeEvidence?: string;
  operationIdEvidence?: string;
}

export function currentConversation(state:ConversationState|undefined, now:Date):ConversationState|undefined {
  if(!state)return undefined;
  const age=now.getTime()-Date.parse(state.updatedAt);
  return Number.isFinite(age)&&age>=0&&age<=15*60000?state:undefined;
}

export function validateTurn(value:unknown, query:string):TurnInterpretation {
  const v=value as TurnInterpretation;
  if(!v||!['query','action','knowledge','analysis','cancel'].includes(v.kind))throw Error('Invalid conversation intent');
  const tools=['aaps_read_history','aaps_read_state','aaps_read_profile','aaps_read_pump_status','aaps_get_operation_status'];
  if(v.queryTool&&!tools.includes(v.queryTool))throw Error('Invalid read tool');
  if(v.route&&!['current_state','daily_report','weekly_report'].includes(v.route))throw Error('Invalid analysis route');
  const quote=(s:unknown)=>typeof s==='string'&&s.length>0&&query.includes(s)?s:undefined;
  const operation=v.action?.operation;
  if(operation&&!['basal','bolus','carbs','cancel_basal'].includes(operation))throw Error('Invalid action type');
  return {kind:v.kind,continuation:v.continuation===true,route:v.route,queryTool:v.queryTool,
    timeEvidence:quote(v.timeEvidence),operationIdEvidence:quote(v.operationIdEvidence),
    ...(v.kind==='action'?{action:{intent:v.continuation?'update':'action',operation,
      evidence:{duration:quote(v.action?.evidence?.duration),amount:quote(v.action?.evidence?.amount),reference:quote(v.action?.evidence?.reference),temporary:quote(v.action?.evidence?.temporary)}} as ActionInterpretation}:{})};
}
