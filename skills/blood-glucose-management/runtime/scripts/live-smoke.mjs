import fs from 'node:fs';
import path from 'node:path';
import {createRuntime,configFromEnv,createSyntheticSimulationInput} from '../dist/index.js';
const config=configFromEnv();
if(!config.model)throw Error('Set LLM config; this test must exercise the real model');
if(!config.stateDir)throw Error('Set a dedicated AGENT_STATE_DIR for test artifacts');
const runtime=createRuntime(config);
const records=[];
try{
  for(const [query,forcedRoute] of [['IOB是什么？请查资料后解释','rag_qa'],['请分析这一周的数据，给出周报和后续建议','weekly_report'],['请检查当前血糖状态，查资料并运行仿真比较方案','current_state']]){
    const result=await runtime.chat({query,forcedRoute,sessionId:'live-read-only',snapshot:createSyntheticSimulationInput()});
    records.push({query,result});
    console.log(JSON.stringify({route:result.route,provider:result.provider,workflow:result.workflow.map(s=>({id:s.id,status:s.status})),plans:result.simulation?.plan.candidateCount}));
  }
  if(process.env.ALLOW_LIVE_WRITE==='yes'){
    if(process.env.AGENT_VIRTUAL_DEVICE_CONFIRMED!==config.relay?.deviceId)throw Error('Explicit virtual-device confirmation is required');
    const query='这是一台未连接人体的AAPS虚拟泵。请调用工具记录2克碳水，不要做任何其他治疗操作。';
    const result=await runtime.chat({query,sessionId:'live-virtual-write',snapshot:createSyntheticSimulationInput()});
    records.push({query,result});
    const pending=result.pendingActions.filter(p=>p.executionStatus==='requires_user_confirmation');
    if(pending.length!==1||pending[0].call.name!=='aaps_record_carbs'||pending[0].call.arguments.carbsG!==2)throw Error('Planner did not produce the exact authorized test action; no command sent');
    const sent=await runtime.confirm(pending[0].confirmationId);
    records.push({confirmation:sent});console.log(JSON.stringify({sent}));
    if(sent.operationId){
      await new Promise(resolve=>setTimeout(resolve,5000));
      const status=await runtime.tool({id:'live-status',name:'aaps_get_operation_status',arguments:{operationId:sent.operationId}});
      records.push({status});console.log(JSON.stringify({status}));
    }
  }
}finally{
  fs.mkdirSync(config.stateDir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(config.stateDir,'live-smoke.json'),JSON.stringify({syntheticPatientData:true,records},null,2)+'\n',{mode:0o600});
  runtime.close();
}
