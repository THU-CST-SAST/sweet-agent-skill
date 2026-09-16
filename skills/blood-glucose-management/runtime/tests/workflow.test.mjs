import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('standalone API exists without an App installation', async()=>{
  assert(fs.existsSync(new URL('../dist/index.js',import.meta.url)), 'standalone bundle must exist');
  const api=await import('../dist/index.js');
  for(const name of ['createRuntime','createSyntheticSimulationInput','runLoopInsightScenario']) assert.equal(typeof api[name],'function');
});

test('same workflow provides Q&A, reports, state and local simulation', async()=>{
  const {createRuntime,createSyntheticSimulationInput}=await import('../dist/index.js');
  const runtime=createRuntime({stateDir:fs.mkdtempSync(path.join(os.tmpdir(),'skill-test-'))});
  const snapshot=createSyntheticSimulationInput();
  for(const [query,route] of [['什么是IOB','rag_qa'],['生成周报','weekly_report'],['检查当前状态','current_state']]){
    const result=await runtime.chat({query,snapshot,forcedRoute:route});
    assert.equal(result.route,route);
    assert(result.workflow.some(s=>s.id==='retrieval'&&s.status==='completed'));
    assert(result.text.length>0);
    if(route==='current_state')assert(result.simulation?.plan.candidateCount===2);
  }
});

test('write requires confirmation, and duplicate confirmations never resend', async()=>{
  const {createRuntime}=await import('../dist/index.js');
  let posts=0;
  const provider={invoke:async c=>{posts++;return {status:'pending',operationId:'op-1',summary:'queued'}}};
  const config={stateDir:fs.mkdtempSync(path.join(os.tmpdir(),'skill-confirm-')),relay:{baseUrl:'https://relay.example',deviceId:'virtual',aiKey:'test-only'}};
  const first=createRuntime(config,{relayProvider:provider});
  const pending=await first.tool({id:'write-1',name:'aaps_record_carbs',arguments:{carbsG:2}});
  assert.equal(posts,0);assert.equal(pending.executionStatus,'requires_user_confirmation');
  const sent=await first.confirm(pending.confirmationId);
  assert.equal(sent.executionStatus,'pending');assert.equal(posts,1);
  const restarted=createRuntime(config,{relayProvider:provider});
  const again=await restarted.confirm(pending.confirmationId);
  assert.equal(again.operationId,'op-1');assert.equal(posts,1);
});
