import type {RuntimeConfig} from './config';
import {requireHttps} from './config';
import {Journal} from './journal';
import {AapsRelayClient} from '../agent/aapsRelayClient';
import {createHash} from 'node:crypto';
export const WRITE_TOOLS=new Set(['aaps_record_carbs','aaps_bolus','aaps_temp_basal_absolute','aaps_temp_basal_percent','aaps_cancel_temp_basal']);
export function validateCall(call:any){
  if(!call||typeof call.id!=='string'||!call.id||call.id.length>200||!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))throw Error('Tool call requires id, name and arguments');
  const fields:Record<string,string[]>={aaps_record_carbs:['carbsG'],aaps_bolus:['insulinU'],aaps_temp_basal_absolute:['rateUph','durationMinutes'],aaps_temp_basal_percent:['percent','durationMinutes'],aaps_cancel_temp_basal:[]};
  if(!WRITE_TOOLS.has(call.name))return;
  for(const k of fields[call.name]){
    const v=call.arguments[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error(`Invalid ${k}`);
    if(['insulinU','carbsG','durationMinutes'].includes(k)&&v<=0)throw Error(`${k} must be positive`);
    if(k==='durationMinutes'&&(!Number.isInteger(v)||v>1440))throw Error('durationMinutes must be an integer <=1440');
  }
  if(Object.keys(call.arguments).some(k=>![...fields[call.name],'reason','confidence','expectedDeviceId'].includes(k)))throw Error('Unexpected action parameters');
  if(call.arguments.expectedDeviceId!==undefined&&(typeof call.arguments.expectedDeviceId!=='string'||!call.arguments.expectedDeviceId.trim()))throw Error('Invalid device binding');
  if(call.arguments.reason!==undefined&&(typeof call.arguments.reason!=='string'||call.arguments.reason.length>4000))throw Error('Invalid reason');
  if(call.arguments.confidence!==undefined&&(typeof call.arguments.confidence!=='number'||!Number.isFinite(call.arguments.confidence)||call.arguments.confidence<0||call.arguments.confidence>1))throw Error('Invalid confidence');
  // The relay encodes percent vs absolute rate in one string. Integer absolute rates are ambiguous.
  if(call.name==='aaps_temp_basal_absolute'&&Number.isInteger(call.arguments.rateUph))throw Error('Relay command syntax cannot unambiguously encode integer absolute rates; use a supported explicit transport');
  if(call.name==='aaps_temp_basal_percent'&&!Number.isInteger(call.arguments.percent))throw Error('Relay percent must be an integer');
}
export function toolController(config:RuntimeConfig,journal:Journal,relayOverride?:any){
  const binding=createHash('sha256').update(JSON.stringify({relay:config.relay?{url:config.relay.baseUrl,deviceId:config.relay.deviceId}:null,ns:config.nightscout?.url??null})).digest('hex');
  if(config.relay)requireHttps(config.relay.baseUrl);
  const relay=relayOverride??(config.relay?new AapsRelayClient(config.relay):null);
  async function prepare(call:any){
    validateCall(call);
    if(!relay)return {tool:call.name,executionStatus:'failed',executed:false,summary:'AAPS relay is not configured'};
    const row=journal.prepare(call,binding);
    return {tool:call.name,callId:call.id,confirmationId:row.id,executionStatus:row.status==='awaiting_confirmation'?'requires_user_confirmation':row.status,executed:false,summary:'Confirm this exact action once',call};
  }
  async function confirm(id:string){
    if(!relay)throw Error('AAPS relay is not configured');
    const row=journal.get(id,binding),call=JSON.parse(row.payload);validateCall(call);
    if(!journal.claim(id,binding)){const existing=journal.get(id,binding);return existing.result?JSON.parse(existing.result):{executionStatus:existing.status==='superseded'?'failed':'unknown',executed:false,summary:existing.status==='superseded'?'This confirmation was invalidated by a newer conversation turn.':'A previous process claimed this POST. Do not resend; reconcile the relay audit.'};}
    let result;
    try{const r=await relay.invoke(call);result={tool:call.name,callId:call.id,operationId:r.operationId,executionStatus:r.status==='succeeded'?'completed':r.status,executed:r.status==='succeeded',summary:r.summary,data:r.data};}
    catch(e:any){result={tool:call.name,callId:call.id,executionStatus:'unknown',executed:false,summary:`Transport did not establish a terminal outcome${e.response?.status?` (HTTP ${e.response.status})`:''}; do not automatically resend`};}
    journal.finish(id,result);return result;
  }
  async function status(operationId:string){
    if(!relay)throw Error('AAPS relay is not configured');
    const r=await relay.invoke({id:`status-${operationId}`,name:'aaps_get_operation_status',arguments:{operationId}});
    return {tool:'aaps_get_operation_status',operationId,executionStatus:r.status==='succeeded'?'completed':r.status,executed:r.status==='succeeded',summary:r.summary,data:r.data};
  }
  return {prepare,confirm,status,binding};
}
