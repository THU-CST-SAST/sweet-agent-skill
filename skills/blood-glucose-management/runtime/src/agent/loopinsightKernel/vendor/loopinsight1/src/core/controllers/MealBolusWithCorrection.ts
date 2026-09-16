// @ts-nocheck
/**
 * This file is part of LoopInsighT1, an open source tool to
 * simulate closed-loop glycemic control in type 1 diabetes.
 * Distributed under the MIT software license.
 * See https://lt1.org for further information.
 */

import type Controller from '../../types/Controller'
import type { ModuleProfile } from '../../types/ModuleProfile'
import ControllerUnion from '../ControllerUnion'
import CorrectionBolus, {
    CorrectionBolusParameters,
    i18n_tooltip as CorrectionBolus_tooltip,
    i18n_label as MealBolus_label
} from './CorrectionBolus'
import MealBolus, {
    MealBolusParameters,
    i18n_label as CorrectionBolus_label,
    i18n_tooltip as MealBolus_tooltip
} from './MealBolus'

export const profile: ModuleProfile = {
    type: "controller",
    id: "MealBolusWithCorrection",
    version: "2.0.0",
    name: "Meal bolus with correction",
}


/**
 * Class representing a controller that administers a meal bolus
 * and accounts for current BG levels with a correction factor.
 */
export default class MealBolusWithCorrection
    extends ControllerUnion
    implements Controller {

    constructor(parameters = {}) {
        super([
            new MealBolus(parameters),
            new CorrectionBolus(parameters),
        ])
    }

    getModelInfo(): ModuleProfile {
        return profile
    }

}

export const MealBolusWithCorrectionParameters = {
    ...MealBolusParameters,
    ...CorrectionBolusParameters
}

export const i18n_label = {
    ...MealBolus_label,
    ...CorrectionBolus_label,
}

export const i18n_tooltip = {
    ...MealBolus_tooltip,
    ...CorrectionBolus_tooltip,
}
