import {readFileSync} from 'node:fs';
import {createRuntime,configFromEnv,createSyntheticSimulationInput,runLoopInsightScenario,searchKnowledgeCandidates} from './index';
const command=process.argv[2]??'help';
if(command==='help'){
  process.stdout.write('Usage: node scripts/agent.mjs <chat|tool|confirm|snapshot|simulate|scenario|search|demo> < input.json\nSet AGENT_CONFIG_FILE or environment variables documented in references/standalone-runtime.md.\n');
}else{
  let runtime:ReturnType<typeof createRuntime>|undefined;
  try{
    const config=process.env.AGENT_CONFIG_FILE?JSON.parse(readFileSync(process.env.AGENT_CONFIG_FILE,'utf8')):configFromEnv();
    const input=command==='demo'?{}:JSON.parse(readFileSync(0,'utf8')||'{}');
    runtime=createRuntime(config);
    let result;
    if(command==='demo')result={synthetic:true,...await runtime.chat({query:'检查当前血糖状态',forcedRoute:'current_state',snapshot:createSyntheticSimulationInput()})};
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
