import {runLoopInsightScenario as run,type LoopInsightScenario} from '../agent/loopinsightKernel/scenarioRunner';
export function runLoopInsightScenario(input:LoopInsightScenario){
  const start=Date.parse(input.start),end=Date.parse(input.end),dt=input.dtMinutes;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>31*86400000)throw Error('Scenario must span a positive interval of at most 31 days');
  if(!Number.isFinite(dt)||dt<=0||(end-start)/60000/dt>100000)throw Error('Invalid timestep or more than 100000 output points');
  if(!Number.isInteger(input.seed)||!Number.isFinite(input.basalRateUPerHour)||input.basalRateUPerHour<0)throw Error('Invalid seed or basal rate');
  for(const [items,key] of [[input.meals,'carbs'],[input.exercise,'intensity']] as const){
    if(!Array.isArray(items))throw Error('meals and exercise arrays are required');
    for(const event of items){
      if(!Number.isFinite(Date.parse(event.start))||!Number.isFinite(event.duration)||event.duration<=0||!Number.isFinite((event as any)[key])||(event as any)[key]<0)throw Error('Invalid scenario event');
    }
  }
  if(input.patientParameters&&Object.values(input.patientParameters).some(v=>!Number.isFinite(v)))throw Error('Patient parameters must be finite numbers');
  return run(input);
}
