import Simulator from './vendor/loopinsight1/src/core/Simulator';
import StaticInsulinPump from './vendor/loopinsight1/src/core/actuators/StaticInsulinPump';
import CSII from './vendor/loopinsight1/src/core/controllers/CSII';
import VirtualPatientDeichmann from './vendor/loopinsight1/src/core/models/Deichmann2021';
import IdealCGM from './vendor/loopinsight1/src/core/sensors/IdealCGM';

export type LoopInsightScenario = {
  start: string;
  end: string;
  dtMinutes: number;
  seed: number;
  patientParameters?: Readonly<Record<string, number>>;
  basalRateUPerHour: number;
  meals: ReadonlyArray<{
    start: string;
    duration: number;
    carbs: number;
  }>;
  exercise: ReadonlyArray<{
    start: string;
    duration: number;
    intensity: number;
  }>;
};

export type LoopInsightScenarioPoint = {
  time: string;
  glucoseMgdl: number;
  cgmMgdl: number | null;
  insulinInfusionUPerHour: number;
  carbsGPerMin: number;
  exercisePercent: number;
  state: Record<string, number>;
};

export function runLoopInsightScenario(
  scenario: LoopInsightScenario,
): LoopInsightScenarioPoint[] {
  const simulator = new Simulator();
  const patient = new VirtualPatientDeichmann(
    scenario.patientParameters as Record<string, number> | undefined,
  );

  simulator.setPatient(patient);
  simulator.setController(new CSII({
    basalRate: scenario.basalRateUPerHour,
    samplingTime: 1,
  }));
  simulator.setSensor(new IdealCGM());
  simulator.setActuator(new StaticInsulinPump());
  simulator.setMeals(scenario.meals.map(meal => ({
    ...meal,
    start: new Date(meal.start),
  })));
  simulator.setExerciseUnits(scenario.exercise.map(item => ({
    ...item,
    start: new Date(item.start),
  })));
  simulator.setOptions({
    t0: new Date(scenario.start),
    tmax: new Date(scenario.end),
    dt: scenario.dtMinutes,
    seed: scenario.seed,
  });

  return simulator.runSimulation().map(result => ({
    time: result.t.toISOString(),
    glucoseMgdl: result.y.Gp,
    cgmMgdl: result.s.CGM ?? null,
    insulinInfusionUPerHour: result.u.iir ?? 0,
    carbsGPerMin: result.u.carbs ?? 0,
    exercisePercent: result.u.exercise ?? 0,
    state: { ...result.x },
  }));
}
