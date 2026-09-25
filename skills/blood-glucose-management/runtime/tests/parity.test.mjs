import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntime,runIntegratedSimulation,runLoopInsightScenario} from '../dist/index.js';
const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/source-app-golden.json',import.meta.url)));
test('all four App routes match original-source answers and evidence',async()=>{
  const runtime=createRuntime({stateDir:fs.mkdtempSync(path.join(os.tmpdir(),'parity-'))});
  try{for(const entry of golden.answers){
    const actual=await runtime.chat({query:entry.query,forcedRoute:entry.route,now:golden.now,snapshot:golden.snapshot});
    for(const field of ['route','state','sources','text','provider']){
      // Knowledge-only questions no longer fetch or prepend irrelevant device data.
      const expected=entry.route==='rag_qa'&&field==='text'
        ?entry.answer.text.replace(/^Agent 工具调用：[\s\S]*?\n\n(?=结论：)/,'')
        :entry.answer[field];
      assert.deepEqual(actual[field],expected,`${entry.route}.${field}`);
    }
  }}finally{runtime.close();}
});
test('two-plan curves and every simulation output match original App exactly',async()=>{
  const actual=await runIntegratedSimulation(golden.simulationInput);
  assert(Number.isFinite(Date.parse(actual.generatedAt)));
  assert.deepEqual({...actual,generatedAt:golden.simulation.generatedAt},golden.simulation);
});
for(const {input,points} of golden.scenarios)test(`full state trajectories match original App: ${input.end}`,()=>{
  assert.deepEqual(runLoopInsightScenario(input),points);
});
