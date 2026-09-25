import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntime} from '../dist/index.js';

const config=()=>({stateDir:fs.mkdtempSync(path.join(os.tmpdir(),'relay-history-'))});
const call={id:'history',name:'aaps_read_history',arguments:{historyMinutes:43200}};
test('persisted query follow-ups keep relay routing without an implicit NS snapshot',async()=>{
  const windows=[];
  const cfg=config();
  const provider={invoke:async c=>{windows.push(c.arguments.historyMinutes);return {status:'succeeded',data:{source:'aaps_relay',treatments:[{type:'carbs',value:10}]}};}};
  let r=createRuntime(cfg,{relayProvider:provider});
  await r.chat({query:'读取最近三十天的记录',sessionId:'windows'});
  r.close();
  r=createRuntime(cfg,{relayProvider:provider});
  try{
    const answer=await r.chat({query:'改成七天',sessionId:'windows'});
    assert.deepEqual(windows,[43200,10080]);
    assert.equal(answer.session.query.historyMinutes,10080);
    assert(answer.text.includes('AAPS 中转站'));
  }finally{r.close();}
});
test('action follow-ups survive process restart and cancellation prevents resuming them',async()=>{
  const cfg=config();let writes=0;
  const provider={invoke:async c=>{
    if(c.name!=='aaps_read_pump_status')writes++;
    return {status:'succeeded',data:{source:'aaps_relay',device_id:'mock-device',pump_connected:true,last_seen:new Date().toISOString()}};
  }};
  let r=createRuntime(cfg,{relayProvider:provider});
  const a=await r.chat({query:'调整临时基础率，相对当前执行值上调20%',sessionId:'draft'});
  assert.equal(a.session.action.amount,20);
  r.close();
  r=createRuntime(cfg,{relayProvider:provider});
  try{
    const b=await r.chat({query:'持续六个小时',sessionId:'draft'});
    assert.equal(b.session.action.durationMinutes,360);
    assert.equal(b.session.action.reference,'current');
    assert.equal(b.pendingActions.length,0);
    const c=await r.chat({query:'算了',sessionId:'draft'});
    assert.equal(c.session,undefined);
    assert.equal(writes,0);
  }finally{r.close();}
});
test('simple device actions bypass the model but still require confirmation',async()=>{
  let sent=0;
  const r=createRuntime(config(),{relayProvider:{invoke:async call=>{
    if(call.name==='aaps_read_pump_status')return {status:'succeeded',data:{source:'aaps_relay',device_id:'mock-device',pump_connected:true,last_seen:new Date().toISOString()}};
    sent++;return {status:'succeeded',summary:'mock receipt'};
  }}});
  try{
    const incomplete=await r.chat({query:'给当前设备的基础率上调20%'});
    assert(incomplete.text.includes('持续多久'));
    assert.equal(incomplete.pendingActions.length,0);
    const complete=await r.chat({query:'设置临时基础率为Profile计划基础率的120%，持续30分钟'});
    assert.equal(sent,0);
    assert.equal(complete.pendingActions.length,1);
    assert(!complete.workflow.some(s=>s.id==='planning'));
    await r.confirm(complete.pendingActions[0].confirmationId);
    assert.equal(sent,1);
  }finally{r.close();}
});
test('relay history works without NS or a model',async()=>{
  const r=createRuntime(config(),{relayProvider:{invoke:async c=>{
    assert.equal(c.name,'aaps_read_history');
    return {status:'succeeded',data:{source:'aaps_relay',treatments:[{type:'carbs',value:10}]}};
  }}});
  try{const result=await r.tool(call);assert.equal(result.data.source,'aaps_relay');assert.equal(result.data.treatments[0].value,10);}
  finally{r.close();}
});
test('an empty relay response is explicit when NS is unavailable',async()=>{
  const r=createRuntime(config(),{relayProvider:{invoke:async()=>({status:'succeeded',data:{source:'aaps_relay',treatments:[]}})}});
  try{const result=await r.tool(call);assert.equal(result.data.nightscoutUnavailable,true);assert.equal(result.data.fallbackReason,'relay_history_empty');}
  finally{r.close();}
});
test('an explicit replay anchor never queries current relay history',async()=>{
  let count=0;
  const r=createRuntime(config(),{relayProvider:{invoke:async()=>{count++;throw Error('must not query');}}});
  try{const result=await r.tool({...call,arguments:{asOf:'latest'}});assert.equal(count,0);assert.equal(result.status,'failed');}
  finally{r.close();}
});
