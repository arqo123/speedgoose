import {SpeedGooseDebuggerOperations} from "../../src/types/types"
import {getDebugger} from '../../src/utils/debugUtils'
import * as commonUtils from "../../src/utils/commonUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')

describe(`getDebugger`, () => {
    test(`should return undefined if debug mode is not enabled`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels : ['enabledModel']
            }
        })
        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)

        expect(debug).toBeUndefined()
    })

    test(`should return undefined if debug config is not set`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri'
        })
        
        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)

        expect(debug).toBeUndefined()
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
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels : ['enabledModel']
            }
        })

        const enabledModelDebugger = getDebugger('enabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        const disabledModelDebugger = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY)

        expect(typeof enabledModelDebugger).toEqual('function')
        expect(disabledModelDebugger).toBeUndefined()
    })

    test(`should return funciton if debug mode is enabled for operation`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugOperations : [SpeedGooseDebuggerOperations.CACHE_QUERY]
            }
        })

        const debuggerForEnabledOperation = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY)
        const debuggerForDisabledOperation = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_PIPELINE)

        expect(typeof debuggerForEnabledOperation).toEqual('function')
        expect(debuggerForDisabledOperation).toBeUndefined()
    })
})
