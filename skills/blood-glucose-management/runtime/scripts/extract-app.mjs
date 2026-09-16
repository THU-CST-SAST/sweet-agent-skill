import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const app=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.existsSync(path.join(app,'src/agent/agentService.ts')))throw Error('Pass the source App directory explicitly');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const agent=['agentService','stateBuilder','reportGenerator','expertRules','taskRouter','types','zhipuProvider','agentModelConfig','patientDecisionState','decisionEvidence','knowledge','generatedKnowledge','generatedSkillKnowledge','simulationClient','aapsTools','aapsRelayClient'];
const files=agent.map(n=>`src/agent/${n}.ts`).concat(['src/types/index.ts','src/utils/deviceStatusUtils.ts']);
function walk(p){return fs.readdirSync(path.join(app,p),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${p}/${e.name}`):[`${p}/${e.name}`]);}
files.push(...walk('src/agent/loopinsightKernel'));
const records=[];
for(const file of files){const bytes=fs.readFileSync(path.join(app,file));const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);records.push({file,app_sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
fs.writeFileSync(path.join(root,'source-manifest.json'),JSON.stringify({repository:'drglucom/sweetonline-drgluapp',branch:execFileSync('git',['branch','--show-current'],{cwd:app,encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),description:'Current working-tree snapshot, including locally edited workflow files. Boundary adaptations are documented separately.',files:records},null,2)+'\n');
console.log(`Copied ${records.length} source files. Do not re-run over adapted files without reviewing the diff.`);
