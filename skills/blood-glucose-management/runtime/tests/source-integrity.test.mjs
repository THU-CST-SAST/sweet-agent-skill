import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync(new URL('../source-manifest.json',import.meta.url)));
const adaptations=new Set(['src/agent/agentService.ts','src/agent/zhipuProvider.ts','src/agent/simulationClient.ts','src/agent/aapsRelayClient.ts']);
test('101 extracted source files, including numerical kernel, retain original bytes',()=>{
  let checked=0;
  for(const entry of manifest.files){
    if(adaptations.has(entry.file))continue;
    const bytes=fs.readFileSync(new URL('../'+entry.file,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.app_sha256,entry.file);checked++;
  }
  assert.equal(checked,101);
  assert(fs.existsSync(new URL('../src/agent/loopinsightKernel/vendor/loopinsight1/LICENSE.md',import.meta.url)));
});
