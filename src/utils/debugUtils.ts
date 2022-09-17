import DebuggerUtils from "debug"
import {CustomDebugger, SpeedGooseConfig, SpeedGooseDebuggerOperations} from "../types/types"
import {getConfig} from "./commonUtils"

export const DEFAULT_DEBUGGER_NAMESPACE = 'speedgoose'
const CACHE_CLEAR = 'cacheClear'

const isDebuggingEnabled = (modelName: string, debuggerOperation: SpeedGooseDebuggerOperations): boolean => {
   const {enabled, debugModels, debugOperations} = getConfig().debugConfig ?? {}

   if (!enabled) {
      return false
   }

   if (Array.isArray(debugModels) && !debugModels.includes(modelName)) {
      return false
   }

   if (Array.isArray(debugOperations) && !debugOperations.includes(debuggerOperation)) {
      return false
   }

   return true
}

const getLabelBackgroundColor = (debug: DebuggerUtils.Debugger): string =>
   '\u001B[4' + (Number(debug.color) < 8 ? Number(debug.color) : '8;5;' + Number(debug.color)) + 'm';

export const emptyDebugCallback = (): object => ({})

export const getDebugger = (modelName: string, debuggerOperation: SpeedGooseDebuggerOperations): CustomDebugger => {
   if (isDebuggingEnabled(modelName, debuggerOperation)) {
      const debug = DebuggerUtils.debug(`${DEFAULT_DEBUGGER_NAMESPACE}:${modelName}:${debuggerOperation}`)

      return (label: string, ...dataToLog: unknown[]) => debug(getLabelBackgroundColor(debug), label, '\x1b[0m', ...dataToLog)
   }
   return emptyDebugCallback
}

export const logCacheClear = (label: string, cacheKey: string): void => {
   const debug = getDebugger(CACHE_CLEAR, SpeedGooseDebuggerOperations.CACHE_CLEAR)
   if (debug) {
      debug(label, cacheKey)
   }
}

export const setupDebugger = (config: SpeedGooseConfig): void => {
   if (!config?.debugConfig?.enabled) {
      return
   }

   const modelsToDebug = config?.debugConfig?.debugModels ? [...config.debugConfig.debugModels, CACHE_CLEAR] : ['*']
   const operationsToDebug = config?.debugConfig?.debugOperations ?? ['*']

   const nameSpacesToEnable = modelsToDebug.flatMap(model =>
      operationsToDebug.map(operation =>
         `${DEFAULT_DEBUGGER_NAMESPACE}:${model}:${operation}`))

   DebuggerUtils.enable(nameSpacesToEnable.toString())
}

