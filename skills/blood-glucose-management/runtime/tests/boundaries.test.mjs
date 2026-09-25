import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import {createRuntime,NightscoutReader,createSyntheticSimulationInput,runLoopInsightScenario} from '../dist/index.js';
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'boundary-'));
const relay={baseUrl:'https://relay.example',deviceId:'virtual',aiKey:'test-only'};

test('state and safety tools run independently; malformed scenarios cannot loop forever',async()=>{
  const r=createRuntime({stateDir:dir()});
  try{
    const snapshot=createSyntheticSimulationInput();
    const state=await r.tool({id:'state',name:'analyze_state',arguments:{snapshot}});
    assert.equal(typeof state.glucose.currentMgdl,'number');
    const safety=await r.tool({id:'safety',name:'review_safety',arguments:{snapshot}});
    assert(Array.isArray(safety));
    assert.throws(()=>runLoopInsightScenario({start:'2026-09-01',end:'2026-09-02',dtMinutes:0,seed:1,basalRateUPerHour:0.5,meals:[],exercise:[]}));
  }finally{r.close();}
});

test('NS splits capped queries and preserves full historical window',async()=>{
  const start=Date.parse('2026-09-01T00:00:00Z');
  const records=Array.from({length:1500},(_,i)=>({date:start+i*60000,sgv:5,units:'mmol/L'}));
  let requests=0;
  const reader=new NightscoutReader({url:'https://ns.example'},async(url,options)=>{
    requests++;assert.equal(options.redirect,'error');const u=new URL(url);
    const from=Number(u.searchParams.get('find[date][$gte]')),to=Number(u.searchParams.get('find[date][$lt]'));
    return new Response(JSON.stringify(records.filter(r=>r.date>=from&&r.date<to).slice(0,1000)));
  });
  const rows=await reader.range('entries',start,start+1500*60000);
  assert.equal(rows.length,1500);assert.equal(requests,3);
});
test('NS latest anchor, units and dated Profile exclude future data',async()=>{
  const now='2026-09-01T12:00:00Z',date=Date.parse(now);
  const reader=new NightscoutReader({url:'https://ns.example'},async url=>{
    const u=new URL(url);
    if(u.pathname.includes('entries')&&u.searchParams.get('count')==='1')assert.equal(u.searchParams.get('find[date][$gte]'),'0','latest must search archived NS data, not the default 24h window');
    const rows=u.pathname.includes('entries')?[{date,sgv:5,units:'mmol/L'}]:u.pathname.includes('profile')?[{startDate:'2026-09-02',id:'future'},{startDate:'2026-08-01',id:'past'}]:[];
    return new Response(JSON.stringify(rows));
  });
  const s=await reader.snapshot({asOf:'latest'});
  assert.equal(s.entries[0].sgv,90);assert.equal(s.profile.id,'past');assert.equal(Date.parse(s.asOf),date);
});
test('different device cannot reuse confirmation; invalid doses never POST',async()=>{
  let posts=0;const fake={invoke:async()=>{posts++;return {status:'pending'}}};const stateDir=dir();
  const a=createRuntime({stateDir,relay},{relayProvider:fake});
  const p=await a.tool({id:'x',name:'aaps_bolus',arguments:{insulinU:0.1}});
  const b=createRuntime({stateDir,relay:{...relay,deviceId:'other'}},{relayProvider:fake});
  await assert.rejects(()=>b.confirm(p.confirmationId));
  await assert.rejects(()=>a.tool({id:'bad',name:'aaps_bolus',arguments:{insulinU:-1}}));
  await assert.rejects(()=>a.tool({id:'x',name:'aaps_bolus',arguments:{insulinU:0.2}}));
  assert.equal(posts,0);a.close();b.close();
});
test('unknown transport outcome is persisted and never automatically resent',async()=>{
  let posts=0;const r=createRuntime({stateDir:dir(),relay},{relayProvider:{invoke:async()=>{posts++;throw Error('connection lost')}}});
  const p=await r.tool({id:'x',name:'aaps_record_carbs',arguments:{carbsG:1}});
  assert.equal((await r.confirm(p.confirmationId)).executionStatus,'unknown');
  await r.confirm(p.confirmationId);assert.equal(posts,1);r.close();
});
test('undefined optional action metadata uses JSON semantics',async()=>{
  const r=createRuntime({stateDir:dir(),relay},{relayProvider:{invoke:async()=>({status:'pending',operationId:'optional-ok'})}});
  try{const p=await r.tool({id:'optional',name:'aaps_record_carbs',arguments:{carbsG:2,reason:undefined}});
    assert.equal((await r.confirm(p.confirmationId)).operationId,'optional-ok');
  }finally{r.close();}
});
test('NS collection errors remain visible as failed tool reads',async()=>{
  const r=createRuntime({stateDir:dir(),nightscout:{url:'https://ns.example'}},{fetch:async url=>{
    const u=new URL(url);return u.pathname.includes('entries')?new Response(JSON.stringify([{date:Date.now()-60000,sgv:100}])):new Response('denied',{status:403});
  }});
  try{for(const name of ['aaps_read_profile','aaps_read_history','aaps_read_pump_status','aaps_read_state']){
    const result=await r.tool({id:name,name,arguments:{}});assert.equal(result.status,'failed',name);assert(result.data.warnings.length>0,name);
  }}finally{r.close();}
});
test('model plans tools, reranks evidence, narrates, and receives persisted conversation',async()=>{
  const original=axios.defaults.adapter;const stages=[];const prompts=[];
  axios.defaults.adapter=async config=>{
    const body=JSON.parse(config.data);const system=body.messages[0].content;prompts.push(body.messages);
    let content;
    if(system.includes('对话理解器')){stages.push('understanding');content=JSON.stringify({kind:'analysis',continuation:false});}
    else if(system.includes('规划器')){stages.push('planning');content=JSON.stringify({objective:'Read and record requested carbs',searchQueries:[{purpose:'topic',query:'碳水'},{purpose:'safety',query:'工具确认 安全'}],tools:['search_knowledge'],toolCalls:[{id:'model-action',name:'aaps_record_carbs',arguments:{carbsG:2}}],recommendationFocus:['Check receipt']});}
    else if(system.includes('重排器')){stages.push('reranking');const candidates=JSON.parse(body.messages[1].content.split('候选材料：')[1]);content=JSON.stringify({selectedIds:candidates.slice(0,2).map(c=>c.id),reason:'test'});}
    else{stages.push('narration');content='已查阅资料；记录 2 克碳水等待确认，尚未执行。';}
    return {data:{choices:[{message:{content},finish_reason:'stop'}]},status:200,statusText:'OK',headers:{},config};
  };
  let posts=0;const r=createRuntime({stateDir:dir(),relay,model:{baseUrl:'https://llm.example/v1',model:'test-model',apiKey:'test-only'}},{relayProvider:{invoke:async()=>{posts++;return {status:'pending',operationId:'queued'}}}});
  try{
    const a=await r.chat({query:'请先分析碳水记录再准备记录2克碳水',sessionId:'conversation',snapshot:createSyntheticSimulationInput()});
    assert.deepEqual(stages,['understanding','planning','reranking','narration']);assert.equal(a.pendingActions.length,1);assert.equal(posts,0);
    assert.equal(a.pendingActions[0].executionStatus,'requires_user_confirmation');
    await r.confirm(a.pendingActions[0].confirmationId);assert.equal(posts,1);
    await r.chat({query:'上一条是什么',sessionId:'conversation',snapshot:createSyntheticSimulationInput()});
    assert(JSON.stringify(prompts[4]).includes('请先分析碳水记录再准备记录2克碳水'));
  }finally{axios.defaults.adapter=original;r.close();}
});
test('real relay adapter serializes all five actions and retains server safety checks',async()=>{
  const original=axios.defaults.adapter;const sent=[];
  axios.defaults.adapter=async config=>{assert.equal(config.maxRedirects,0);const body=JSON.parse(config.data);sent.push(body);return {data:{status:'ok',data:{command_id:`op-${sent.length}`,cmd:body.cmd}},status:201,statusText:'Created',headers:{},config};};
  const r=createRuntime({stateDir:dir(),relay});
  try{for(const [name,args] of [['aaps_record_carbs',{carbsG:2}],['aaps_bolus',{insulinU:0.1}],['aaps_temp_basal_absolute',{rateUph:0.2,durationMinutes:30}],['aaps_temp_basal_percent',{percent:80,durationMinutes:30}],['aaps_cancel_temp_basal',{}]]){
    const p=await r.tool({id:name,name,arguments:args});await r.confirm(p.confirmationId);
  }assert.equal(sent.length,5);assert(sent.every(b=>b.skip_safety===false));assert.deepEqual(sent.map(b=>b.cmd),['CARBS 2','BOLUS 0.1','BASAL 0.2 30','BASAL 80 30','BASAL STOP']);}
  finally{axios.defaults.adapter=original;r.close();}
});

test('model-requested earlier and later Profile anchors refetch rather than reuse chat state',async()=>{
  const original=axios.defaults.adapter;let target='2026-08-31T12:00:00Z';let requests=0;let answerContext='';
  axios.defaults.adapter=async config=>{
    const body=JSON.parse(config.data),system=body.messages[0].content;
    if(!system.includes('规划器')&&!system.includes('重排器'))answerContext=body.messages[1].content;
    const content=system.includes('规划器')?JSON.stringify({objective:'read historical profile',searchQueries:[{purpose:'profile',query:'Profile配置'}],tools:['search_knowledge'],toolCalls:[{id:'anchor',name:'aaps_read_profile',arguments:{asOf:target}}],recommendationFocus:[]}):system.includes('重排器')?JSON.stringify({selectedIds:JSON.parse(body.messages[1].content.split('候选材料：')[1]).slice(0,1).map(c=>c.id)}):'历史配置已读取。';
    return {data:{choices:[{message:{content},finish_reason:'stop'}]},status:200,statusText:'OK',headers:{},config};
  };
  const r=createRuntime({stateDir:dir(),nightscout:{url:'https://ns.example'},model:{baseUrl:'https://llm.example',model:'test',apiKey:'test-only'}},{fetch:async url=>{
    requests++;const u=new URL(url);return new Response(JSON.stringify(u.pathname.includes('profile')?[{id:'earlier',startDate:'2026-08-31'},{id:'later',startDate:'2026-09-02'}]:[]));
  }});
  try{for(const [asOf,expected] of [['2026-08-31T12:00:00Z','earlier'],['2026-09-02T12:00:00Z','later']]){
    target=asOf;
    const result=await r.chat({query:'请读取指定日期Profile',forcedRoute:'rag_qa',snapshot:{entries:[],treatments:[],profile:{id:'initial'},deviceStatus:null,asOf:'2026-09-01T12:00:00Z',rangeStart:'2026-08-30T00:00:00Z',sourceUrl:'https://ns.example'}});
    assert(answerContext.includes(`\"id\":\"${expected}\"`),expected);
  }assert(requests>=8);}finally{axios.defaults.adapter=original;r.close();}
});
