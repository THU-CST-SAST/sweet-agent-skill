// @ts-nocheck
/**
 * This file is part of LoopInsighT1, an open source tool to
 * simulate closed-loop glycemic control in type 1 diabetes.
 * Distributed under the MIT software license.
 * See https://lt1.org for further information.
 */

import type { ModuleType } from './ModuleProfile'
import type { ParameterValues } from './ParametricModule'


export type ParameterFileContents = {
    type: ModuleType
    model: string
    version: string
    created?: Date
    name?: string
    description?: string
    parameters: ParameterValues
}

export type ParameterFileList = {
    [key: string]: ParameterFileContents
}
