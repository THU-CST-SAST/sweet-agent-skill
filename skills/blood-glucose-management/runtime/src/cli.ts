import {readFileSync} from 'node:fs';
import {createRuntime,configFromEnv,createSyntheticSimulationInput,runLoopInsightScenario,searchKnowledgeCandidates} from './index';
const command=process.argv[2]??'help';
if(command==='help'){
  process.stdout.write('Host-agent tools: node scripts/agent.mjs <tool|confirm|snapshot|simulate|scenario|search|demo> < input.json\nNo model API is needed: the host agent plans and answers using tool results.\nOptional legacy chat command runs a separate App-style model workflow.\nSet NS/relay configuration as documented in references/standalone-runtime.md.\n');
}else{
  let runtime:ReturnType<typeof createRuntime>|undefined;
  try{
    const config=process.env.AGENT_CONFIG_FILE?JSON.parse(readFileSync(process.env.AGENT_CONFIG_FILE,'utf8')):configFromEnv();
    if(command!=='chat')delete config.model;
    const input=command==='demo'?{}:JSON.parse(readFileSync(0,'utf8')||'{}');
    runtime=createRuntime(config);
    let result;
    if(command==='demo'){
      const snapshot=createSyntheticSimulationInput();
      result={synthetic:true,orchestration:'host-agent',snapshot,
        evidence:searchKnowledgeCandidates('IOB与血糖趋势',6),
        state:await runtime.tool({id:'demo-state',name:'analyze_state',arguments:{snapshot}}),
        simulation:await runtime.simulate({snapshot})};
    }
    else if(command==='chat')result=await runtime.chat(input);
    else if(command==='tool')result=await runtime.tool(input);
    else if(command==='confirm')result=await runtime.confirm(input.confirmationId);
    else if(command==='snapshot')result=await runtime.snapshot(input);
    else if(command==='simulate')result=await runtime.simulate(input);
    else if(command==='scenario')result=runLoopInsightScenario(input);
    else if(command==='search')result=searchKnowledgeCandidates(input.query,input.limit??6);
    else throw Error('Unknown command');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error:any){process.stderr.write(JSON.stringify({error:error.response?`HTTP ${error.response.status??'transport failure'}`:error.message})+'\n');process.exitCode=1;}
  finally{runtime?.close();}
}
