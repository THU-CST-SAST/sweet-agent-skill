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
export {createSyntheticSimulationInput,runIntegratedSimulation} from './agent/simulationClient';
export {runLoopInsightScenario} from './runtime/scenario';
export {Simulator,VirtualPatientDeichmann,IdealCGM,StaticInsulinPump,AbstractController} from './agent/loopinsightKernel';
export {searchKnowledgeCandidates,buildPatientDecisionState};
export {NightscoutReader} from './runtime/nightscout';
export {configFromEnv} from './runtime/config';

export function createRuntime(config:RuntimeConfig={},overrides:{relayProvider?:any;fetch?:typeof fetch}={}){
  if(config.model)requireHttps(config.model.baseUrl);
  const journal=new Journal(stateDirectory(config));
  const actions=toolController(config,journal,overrides.relayProvider);
  const reader=config.nightscout?new NightscoutReader(config.nightscout,overrides.fetch):null;
  const context=()=>({storage:new Map(config.model?[['agent_model_config_v1',JSON.stringify({...config.model,enabled:config.model.enabled!==false})]]:[]),simulation:undefined as unknown});
  async function snapshot(options:any={}){
    if(options.snapshot)return options.snapshot;
    if(!reader)return {entries:[],treatments:[],profile:null,deviceStatus:null,warnings:['Nightscout is not configured']};
    return reader.snapshot(options);
  }
  async function read(call:any,supplied?:any){
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
    return {status:'succeeded',summary:'Read Nightscout data; relay history is not patient treatment history',data};
  }
  async function tool(call:any){
    validateCall(call);
    if(WRITE_TOOLS.has(call.name))return actions.prepare(call);
    if(call.name==='search_knowledge')return searchKnowledgeCandidates(String(call.arguments.query??''),Math.min(24,Math.max(1,Number(call.arguments.limit)||6)));
    if(call.name==='run_simulation')return simulate(call.arguments);
    if(call.name==='run_scenario')return runLoopInsightScenario(call.arguments);
    if(call.name==='analyze_state'||call.name==='review_safety'){
      const s=await snapshot(call.arguments);
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
    const route=routeAgentTask(input.query,input.forcedRoute);
    const s=await snapshot({...input,historyMinutes:input.historyMinutes??(route==='weekly_report'?10080:1440)});
    const ctx=context(),calls:any[]=[];
    const sessionId=input.sessionId?`${actions.binding}:${input.sessionId}`:null;
    const history=sessionId?journal.history(sessionId):[];
    const turnId=randomUUID();
    const result=await withContext(ctx,()=>answerAgentQuery({
      ...s,query:input.query,forcedRoute:input.forcedRoute,rules:input.rules??DEFAULT_EXPERT_RULES,
      now:new Date(input.now??s.asOf??Date.now()),conversationHistory:history,onProgress:input.onProgress,
      aapsProvider:{invoke:call=>read(call,s)},confirmedAapsCallIds:new Set(),
      onToolCalls:selected=>{for(const call of selected){call.id=`${turnId}:${call.id}`;calls.push(call);}},
    }));
    const pendingActions=[];
    for(const call of calls.filter(c=>WRITE_TOOLS.has(c.name))){
      try{pendingActions.push(await actions.prepare(call));}
      catch{pendingActions.push({call,executionStatus:'failed',executed:false,summary:'Invalid or unsupported action parameters; nothing sent'});}
    }
    if(sessionId)journal.saveHistory(sessionId,[...history,{role:'user',text:input.query},{role:'assistant',text:result.text}]);
    return {...result,simulation:ctx.simulation,pendingActions,dataWarnings:s.warnings??[],sessionId:input.sessionId??null};
  }
  return {chat,tool,simulate,snapshot,confirm:actions.confirm,close:()=>journal.close()};
}
