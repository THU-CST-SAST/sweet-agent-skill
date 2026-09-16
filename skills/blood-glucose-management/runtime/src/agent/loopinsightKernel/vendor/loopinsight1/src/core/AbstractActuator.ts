// @ts-nocheck
/**
 * This file is part of LoopInsighT1, an open source tool to
 * simulate closed-loop glycemic control in type 1 diabetes.
 * Distributed under the MIT software license.
 * See https://lt1.org for further information.
 */

import { nextUpdateTime } from '../common/DateUtility'
import { ControllerOutput, Medication } from '../types/Actuator'
import type Actuator from '../types/Actuator'
import type { ModuleProfile } from '../types/ModuleProfile'
import type { ParameterDescriptions } from '../types/ParametricModule'
import type Solver from '../types/Solver'
import AbstractParametricModule from './AbstractParametricModule'

/**
 * Abstract class suited to implement an actuator module
 * @extends AbstractParametricModule
 * @implements {Actuator}
 */
export default abstract class AbstractActuator
    <Parameters extends ParameterDescriptions>
    extends AbstractParametricModule
    <Parameters, typeof CommonActuatorParametersDescription>
    implements Actuator {

    /**
     * Provides description of common parameters.
     */
    override getCommonParameterDescription() {
        return CommonActuatorParametersDescription
    }

    /**
     * Returns information about the model.
     * @returns {ModuleProfile} Profile.
     */
    abstract getModelInfo(): ModuleProfile

    /**
     * Returns list of inputs used by this actuator.
     * @returns {Array<keyof ControllerOutput>} List of inputs.
     */
    abstract getInputList(): Array<keyof ControllerOutput>

    /**
     * Returns list of outputs provided by this actuator.
     * @returns {Array<keyof Medication>} List of outputs.
     */
    abstract getOutputList(): Array<keyof Medication>

    /**
     * Computes medication actually administered by actuator.
     * @param {Date} t - Current time
     * @param {ControllerOutput} c - Medication requested by controller
     * @returns {ControllerOutput}
     */
    abstract update(t: Date, c: ControllerOutput): ControllerOutput

    /**
     * Resets / re-initializes module to default.
     * @param {Date} t - Current time.
     * @param {number} seed - Random seed
     * @param {Solver} solver - Numerical ODE solver.
     */
    abstract reset(_t: Date, _seed: number, _solver: Solver): void

    /**
     * Returns next required update time.
     * @returns {Date | undefined}
     */
    getNextUpdateTime(t: Date): Date | undefined {
        return nextUpdateTime(t, this.evaluateParameterValuesAt(t).samplingTime)
    }
}

/**
 * Description of parameters which are commonly used by actuator models.
 *
 * These values are available implicitly in each child of the abstract class,
 * but they are not listed in getParameterList except if you explicitly include
 * them into the parameterDescription. If you do that, you can overwrite the
 * default value, but please note that you may not change the unit.
 */
export const CommonActuatorParametersDescription = {
    /** sampling time in minutes */
    samplingTime: { unit: "min", default: Infinity },
}
