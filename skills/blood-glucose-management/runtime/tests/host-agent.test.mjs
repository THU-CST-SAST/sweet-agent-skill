import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntime,createSyntheticSimulationInput} from '../dist/index.js';

test('host tools do not depend on a model configuration',async()=>{
  const runtime=createRuntime({stateDir:fs.mkdtempSync(path.join(os.tmpdir(),'host-tools-')),model:{baseUrl:'invalid-unused-model',model:'unused',apiKey:'unused'}});
  try{
    const snapshot=createSyntheticSimulationInput();
    const evidence=await runtime.tool({id:'search',name:'search_knowledge',arguments:{query:'IOB',limit:6}});
    assert(evidence.length>0);
    const state=await runtime.tool({id:'state',name:'analyze_state',arguments:{snapshot}});
    assert(Number.isFinite(state.glucose.currentMgdl));
    const report=await runtime.tool({id:'week',name:'analyze_state',arguments:{snapshot,route:'weekly_report'}});
    assert.equal(report.window.durationHours,168);
    assert.equal((await runtime.simulate({snapshot})).plan.candidateCount,2);
  }finally{runtime.close();}
});

test('CLI demo is tools-only even with inherited model settings',()=>{
  const env={...process.env,AGENT_STATE_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'host-demo-')),LLM_API_KEY:'unused',LLM_BASE_URL:'invalid-unused-model'};
  delete env.AGENT_CONFIG_FILE;
  const run=spawnSync(process.execPath,[new URL('../../scripts/agent.mjs',import.meta.url).pathname,'demo'],{env,encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.orchestration,'host-agent');
  assert.equal(result.synthetic,true);
  assert.equal(result.simulation.plan.candidateCount,2);
  assert(result.evidence.length>0);
  assert.equal(result.text,undefined);
});
