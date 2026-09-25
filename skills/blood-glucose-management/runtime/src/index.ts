import {randomUUID} from 'node:crypto';
import {answerAgentQuery} from './agent/agentService';
import {DEFAULT_EXPERT_RULES,activeSafetyMessages} from './agent/expertRules';
import {buildAgentState} from './agent/stateBuilder';
import {routeAgentTask} from './agent/taskRouter';
import {searchKnowledgeCandidates} from './agent/knowledge';
import {buildPatientDecisionState} from './agent/patientDecisionState';
import {retrieveDecisionEvidence} from './agent/decisionEvidence';
import {runIntegratedSimulation} from './agent/simulationClient';
import {withContext} from './runtime/context';
import {NightscoutReader,recordTime} from './runtime/nightscout';
import {runLoopInsightScenario} from './runtime/scenario';
import {Journal} from './runtime/journal';
import {stateDirectory,requireHttps,type RuntimeConfig} from './runtime/config';
import {toolController,WRITE_TOOLS,validateCall} from './runtime/tools';
import {AapsRelayClient} from './agent/aapsRelayClient';
import {resolveDirectRequest} from './agent/directRequest';
export {createSyntheticSimulationInput,runIntegratedSimulation} from './agent/simulationClient';
export {runLoopInsightScenario} from './runtime/scenario';
export {Simulator,VirtualPatientDeichmann,IdealCGM,StaticInsulinPump,AbstractController} from './agent/loopinsightKernel';
export {searchKnowledgeCandidates,buildPatientDecisionState};
export {NightscoutReader} from './runtime/nightscout';
export {configFromEnv} from './runtime/config';

export function createRuntime(config:RuntimeConfig={},overrides:{relayProvider?:any;fetch?:typeof fetch}={}){
  const journal=new Journal(stateDirectory(config));
  const actions=toolController(config,journal,overrides.relayProvider);
  const relay=overrides.relayProvider??(config.relay?new AapsRelayClient(config.relay):null);
  const reader=config.nightscout?new NightscoutReader(config.nightscout,overrides.fetch):null;
  const context=()=>({storage:new Map(config.model?[['agent_model_config_v1',JSON.stringify({...config.model,enabled:config.model.enabled!==false})]]:[]),simulation:undefined as unknown});
  async function snapshot(options:any={}){
    if(options.snapshot)return options.snapshot;
    if(!reader)return {entries:[],treatments:[],profile:null,deviceStatus:null,warnings:['Nightscout is not configured']};
    return reader.snapshot(options);
  }
  async function read(call:any,supplied?:any){
    if(call.name==='aaps_read_pump_status'&&call.arguments.requireRelay===true){
      return relay?relay.invoke(call):{status:'failed',summary:'Target relay status is not configured'};
    }
    // The relay API supports a current relative window, not historical replay anchors.
    if(call.name!=='aaps_read_history'||call.arguments.asOf!==undefined||supplied){
      return readNightscout(call,supplied);
    }
    const minutes=call.arguments.historyMinutes??1440;
    if(!Number.isFinite(minutes)||minutes<1||minutes>43200)throw Error('Invalid historyMinutes');
    let result:any;
    let reason=relay?'relay_read_failed':'relay_not_configured';
    if(relay){
      try{
        result=await relay.invoke(call);
        if(result?.status==='succeeded'&&Array.isArray(result.data?.treatments)){
          if(result.data.treatments.length)return result;
          reason='relay_history_empty';
        }
      }catch{ /* Only a read request may fall back; never retry a treatment write. */ }
    }
    let nsFailure:any;
    try{
      const ns=await readNightscout(call,supplied);
      if(ns.status==='succeeded')return {...ns,summary:`Relay unavailable or empty; using NS. ${ns.summary}`,
        data:{...ns.data,source:'nightscout',fallbackReason:reason}};
      nsFailure=ns;
    }catch{ /* Report missing history rather than treating it as zero treatment. */ }
    if(result?.status==='succeeded'&&Array.isArray(result.data?.treatments))return {...result,
      summary:`${result.summary} NS fallback unavailable; empty history does not mean no treatment.`,
      data:{...result.data,fallbackReason:reason,nightscoutUnavailable:true}};
    return {status:'failed',summary:'Relay and NS treatment history unavailable',errorCode:'history_sources_unavailable',
      data:{...nsFailure?.data,fallbackReason:reason}};
  }
  async function readNightscout(call:any,supplied?:any){
    if(call.name==='aaps_get_operation_status'){
      const r=await actions.status(call.arguments.operationId);
      return {...r,status:r.executionStatus==='completed'?'succeeded':r.executionStatus};
    }
    if(!['aaps_read_state','aaps_read_history','aaps_read_profile','aaps_read_pump_status'].includes(call.name))throw Error('Unknown read tool');
    if(!supplied&&!reader)return {status:'failed',summary:'Nightscout is not configured'};
    const minutes=call.arguments.historyMinutes??1440;
    if(!Number.isFinite(minutes)||minutes<=0||minutes>44640)throw Error('Invalid historyMinutes');
    const suppliedAnchor=supplied?.asOf??supplied?.entries?.at(-1)?.dateString;
    const requestedAnchor=call.arguments.asOf;
    const differentAnchor=supplied&&requestedAnchor!==undefined&&(requestedAnchor==='latest'||Date.parse(requestedAnchor)!==Date.parse(suppliedAnchor));
    const canRefetch=reader&&supplied?.sourceUrl?.replace(/\/+$/,'')===config.nightscout?.url.replace(/\/+$/,'');
    if(differentAnchor&&!canRefetch)return {status:'failed',summary:'Cannot reconstruct a different time anchor from this offline snapshot',data:{warnings:['Requested time differs from supplied snapshot; configure its matching NS source']}};
    let s=await snapshot({snapshot:differentAnchor?undefined:supplied,historyMinutes:minutes,asOf:requestedAnchor??suppliedAnchor});
    if(call.name==='aaps_read_history'){
      const end=Date.parse(call.arguments.asOf&&call.arguments.asOf!=='latest'?call.arguments.asOf:s.asOf??new Date().toISOString());
      const start=end-minutes*60000;
      const coverageStart=Date.parse(s.rangeStart??s.entries?.[0]?.dateString??'');
      const coverageEnd=Date.parse(s.asOf??s.entries?.at(-1)?.dateString??'');
      if(!Number.isFinite(coverageStart)||coverageStart>start||coverageEnd<end){
        if(reader&&s.sourceUrl===config.nightscout?.url.replace(/\/+$/,''))s=await reader.snapshot({asOf:new Date(end).toISOString(),historyMinutes:minutes});
        else return {status:'failed',summary:'Offline snapshot does not cover requested history window',data:{warnings:['Requested history is outside supplied snapshot coverage'],availableStart:s.rangeStart??s.entries?.[0]?.dateString,availableEnd:s.asOf??s.entries?.at(-1)?.dateString}};
      }
      s={...s,entries:s.entries.filter((r:any)=>recordTime(r)>=start&&recordTime(r)<=end),treatments:s.treatments.filter((r:any)=>recordTime(r)>=start&&recordTime(r)<=end),requestedStart:new Date(start).toISOString(),requestedEnd:new Date(end).toISOString()};
    }
    const data=call.name==='aaps_read_profile'?{profile:s.profile}:call.name==='aaps_read_pump_status'?{deviceStatus:s.deviceStatus}:s;
    const relevant=call.name==='aaps_read_profile'?['profiles']:call.name==='aaps_read_pump_status'?['devicestatus']:call.name==='aaps_read_history'?['treatments']:['treatments','profiles','devicestatus'];
    const unavailable=(s.unavailableCollections??[]).filter((name:string)=>relevant.includes(name));
    if(s.warnings?.length)Object.assign(data,{warnings:s.warnings,unavailableCollections:unavailable});
    if(unavailable.length)return {status:'failed',summary:`Incomplete Nightscout read: ${unavailable.join(', ')} unavailable; do not interpret missing collections as empty patient history`,data};
    if(call.name==='aaps_read_history')return {status:'succeeded',summary:'Read Nightscout treatment history',data:{...data,source:'nightscout'}};
    return {status:'succeeded',summary:'Read Nightscout data; relay history is not patient treatment history',data};
  }
  async function tool(call:any){
    validateCall(call);
    if(WRITE_TOOLS.has(call.name))return actions.prepare(call);
    if(call.name==='search_knowledge')return searchKnowledgeCandidates(String(call.arguments.query??''),Math.min(24,Math.max(1,Number(call.arguments.limit)||6)));
    if(call.name==='run_simulation')return simulate(call.arguments);
    if(call.name==='run_scenario')return runLoopInsightScenario(call.arguments);
    if(call.name==='analyze_state'||call.name==='review_safety'){
      const s=await snapshot({...call.arguments,historyMinutes:call.arguments.historyMinutes??(call.arguments.route==='weekly_report'?10080:1440)});
      const state=buildAgentState({...s,route:call.arguments.route??'current_state',now:new Date(call.arguments.now??s.asOf??Date.now())});
      return call.name==='analyze_state'?state:activeSafetyMessages(state,DEFAULT_EXPERT_RULES);
    }
    return read(call);
  }
  async function simulate(options:any={}){
    const s=await snapshot(options);
    const decision=buildPatientDecisionState({...s,patient:{approvedHypoCarbsG:options.approvedHypoCarbsG}});
    return withContext(context(),()=>runIntegratedSimulation({...s,approvedHypoCarbsG:options.approvedHypoCarbsG??null,evidence:retrieveDecisionEvidence(decision)}));
  }
  async function chat(input:any){
    if(typeof input.query!=='string'||!input.query.trim())throw Error('query is required');
    const direct=(!input.forcedRoute||input.forcedRoute==='rag_qa')?resolveDirectRequest(input.query):null;
    if(config.model&&!direct)requireHttps(config.model.baseUrl);
    const route=routeAgentTask(input.query,input.forcedRoute);
    const s=direct?{entries:[],treatments:[],profile:null,deviceStatus:null,warnings:[]}:await snapshot({...input,historyMinutes:input.historyMinutes??(route==='weekly_report'?10080:1440)});
    const ctx=context(),calls:any[]=[];
    const sessionId=input.sessionId?`${actions.binding}:${input.sessionId}`:null;
    const history=sessionId?journal.history(sessionId):[];
    const task=sessionId?journal.task(sessionId):{};
    for(const id of task.confirmationIds??[])journal.supersede(id,actions.binding);
    const turnId=randomUUID();
    const result=await withContext(ctx,()=>answerAgentQuery({
      ...s,query:input.query,forcedRoute:input.forcedRoute,rules:input.rules??DEFAULT_EXPERT_RULES,
      now:new Date(input.now??s.asOf??Date.now()),conversationHistory:history,onProgress:input.onProgress,session:input.session??task.session,
      aapsProvider:{invoke:call=>read(
        input.asOf!==undefined&&direct?{...call,arguments:{...call.arguments,asOf:input.asOf}}:call,
        (call.name==='aaps_read_history'&&!input.snapshot&&input.asOf===undefined&&call.arguments.asOf===undefined)
          ?undefined:direct?input.snapshot:s,
      )},confirmedAapsCallIds:new Set(),
      onToolCalls:selected=>{for(const call of selected){call.id=`${turnId}:${call.id}`;calls.push(call);}},
    }));
    const pendingActions=[];
    for(const call of calls.filter(c=>WRITE_TOOLS.has(c.name))){
      try{pendingActions.push(await actions.prepare(call));}
      catch{pendingActions.push({call,executionStatus:'failed',executed:false,summary:'Invalid or unsupported action parameters; nothing sent'});}
    }
    if(sessionId)journal.saveHistory(sessionId,[...history,{role:'user',text:input.query},{role:'assistant',text:result.text}]);
    if(sessionId)journal.saveTask(sessionId,{session:result.session,confirmationIds:pendingActions.map((p:any)=>p.confirmationId).filter(Boolean)});
    return {...result,simulation:ctx.simulation,pendingActions,dataWarnings:s.warnings??[],sessionId:input.sessionId??null};
  }
  return {chat,tool,simulate,snapshot,confirm:actions.confirm,close:()=>journal.close()};
}
