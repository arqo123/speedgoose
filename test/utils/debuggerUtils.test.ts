import DebugUtils from "debug"
import {SpeedGooseDebuggerOperations} from "../../src/types/types"
import {emptyDebugCallback, getDebugger, setupDebugger} from '../../src/utils/debugUtils'
import * as commonUtils from "../../src/utils/commonUtils"
import {setupDebuggerTestCases} from "../assets/utils/debuggerUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')
const mockedDebug = jest.spyOn(DebugUtils, 'debug')
const mockedDebugEnable = jest.spyOn(DebugUtils, 'enable')

describe(`getDebugger`, () => {
    test(`should return undefined if debug mode is not enabled`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels: ['enabledModel']
            }
        })
        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        expect(mockedDebug).not.toBeCalled()
        expect(debug).toBe(emptyDebugCallback)
    })

    test(`should return undefined if debug config is not set`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri'
        })

        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)

        expect(mockedDebug).not.toBeCalled()
        expect(debug).toBe(emptyDebugCallback)
    })

    test(`should return funciton if debug mode is enabled`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true
            }
        })

        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)

        expect(typeof debug).toEqual('function')
    })

    test(`should return funciton if debug mode is enabled for given model name`, async () => {
        mockedDebug.mockReset()
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels: ['enabledModel']
            }
        })

        const enabledModelDebugger = getDebugger('enabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        const disabledModelDebugger = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        // Should be only called once for the enabled one
        expect(mockedDebug).toBeCalledTimes(1)
        expect(typeof enabledModelDebugger).toEqual('function')
        expect(disabledModelDebugger).toBe(emptyDebugCallback)
    })

    test(`should return funciton if debug mode is enabled for operation`, async () => {
        mockedDebug.mockReset()

        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugOperations: [SpeedGooseDebuggerOperations.CACHE_QUERY]
            }
        })

        const debuggerForEnabledOperation = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        const debuggerForDisabledOperation = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_PIPELINE)

        // Should be only called once for the enabled one
        expect(mockedDebug).toBeCalledTimes(1)
        expect(typeof debuggerForEnabledOperation).toEqual('function')
        expect(debuggerForDisabledOperation).toBe(emptyDebugCallback)
    })
})


describe('setupDebugger', () => {
    test(`should register debugger namespaces`, () => {
        setupDebuggerTestCases().forEach(testCase => {
            mockedDebugEnable.mockClear()
            
            if (testCase.config.debugConfig?.enabled) {
                setupDebugger(testCase.config)
                expect(mockedDebugEnable).toBeCalledWith(testCase.expectedNamespaces?.toString())
            } else {
                expect(mockedDebugEnable).not.toBeCalled()
            }
        })
    })
})