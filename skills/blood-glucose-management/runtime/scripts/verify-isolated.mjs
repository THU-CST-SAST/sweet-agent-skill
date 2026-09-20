import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const skill=fileURLToPath(new URL('../..',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'standalone-skill-install-'));
const installed=path.join(temp,'blood-glucose-management');
fs.cpSync(skill,installed,{recursive:true,filter:source=>!['node_modules','dist','.state','config.local.json'].includes(path.basename(source))});
const cwd=path.join(installed,'runtime');
const env={...process.env,AGENT_STATE_DIR:path.join(temp,'state')};
for(const key of Object.keys(env))if(/^(LLM_|NIGHTSCOUT_|AAPS_|AGENT_CONFIG_FILE)/.test(key))delete env[key];
for(const args of [['ci','--ignore-scripts'],['test']]){
  const r=spawnSync('npm',args,{cwd,env,encoding:'utf8'});
  process.stdout.write(r.stdout);process.stderr.write(r.stderr);if(r.status!==0)throw Error(`Isolated npm ${args[0]} failed`);
}
const demo=spawnSync(process.execPath,[path.join(installed,'scripts/agent.mjs'),'demo'],{cwd:temp,env,encoding:'utf8'});
if(demo.status!==0)throw Error(demo.stderr);
const result=JSON.parse(demo.stdout);
if(!result.synthetic||result.simulation?.plan.candidateCount!==2)throw Error('Isolated CLI workflow did not produce two simulation candidates');
if(result.orchestration!=='host-agent')throw Error('Demo must use host-agent tools');
console.log(JSON.stringify({installedDirectory:installed,isolatedDemo:true,plans:2,orchestration:result.orchestration}));
