import DebugUtils from 'debug';
import { SpeedGooseDebuggerOperations } from '../../src/types/types';
import { emptyDebugCallback, getDebugger, setupDebugger } from '../../src/utils/debugUtils';
import * as commonUtils from '../../src/utils/commonUtils';
import { setupDebuggerTestCases } from '../assets/utils/debuggerUtils';

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig');
const mockedDebug = jest.spyOn(DebugUtils, 'debug');
const mockedDebugEnable = jest.spyOn(DebugUtils, 'enable');

describe(`getDebugger`, () => {
    test(`should return undefined if debug mode is not enabled`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels: ['enabledModel'],
            },
        });
        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        expect(mockedDebug).not.toHaveBeenCalled();
        expect(debug).toBe(emptyDebugCallback);
    });

    test(`should return undefined if debug config is not set`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
        });

        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY);

        expect(mockedDebug).not.toHaveBeenCalled();
        expect(debug).toBe(emptyDebugCallback);
    });

    test(`should return funciton if debug mode is enabled`, async () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
            },
        });

        const debug = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY);

        expect(typeof debug).toEqual('function');
    });

    test(`should return funciton if debug mode is enabled for given model name`, async () => {
        mockedDebug.mockReset();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels: ['enabledModel'],
            },
        });

        const enabledModelDebugger = getDebugger('enabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        const disabledModelDebugger = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        // Should be only called once for the enabled one
        expect(mockedDebug).toHaveBeenCalledTimes(1);
        expect(typeof enabledModelDebugger).toEqual('function');
        expect(disabledModelDebugger).toBe(emptyDebugCallback);
    });

    test(`should return funciton if debug mode is enabled for operation`, async () => {
        mockedDebug.mockReset();

        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugOperations: [SpeedGooseDebuggerOperations.CACHE_QUERY],
            },
        });

        const debuggerForEnabledOperation = getDebugger('testModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        const debuggerForDisabledOperation = getDebugger('disabledModel', SpeedGooseDebuggerOperations.CACHE_PIPELINE);

        // Should be only called once for the enabled one
        expect(mockedDebug).toHaveBeenCalledTimes(1);
        expect(typeof debuggerForEnabledOperation).toEqual('function');
        expect(debuggerForDisabledOperation).toBe(emptyDebugCallback);
    });
});

describe('setupDebugger', () => {
    test(`should register debugger namespaces`, () => {
        setupDebuggerTestCases().forEach(testCase => {
            mockedDebugEnable.mockClear();

            if (testCase.config.debugConfig?.enabled) {
                setupDebugger(testCase.config);
                expect(mockedDebugEnable).toHaveBeenCalledWith(testCase.expectedNamespaces?.toString());
            } else {
                expect(mockedDebugEnable).not.toHaveBeenCalled();
            }
        });
    });
});

describe('custom logger', () => {
    beforeEach(() => {
        mockedDebug.mockClear();
    });

    test('should call custom logger when provided', () => {
        const customLogger = jest.fn();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                customLogger,
            },
        });

        const debug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        debug('test label', { some: 'data' });

        expect(customLogger).toHaveBeenCalledWith(
            'speedgoose:TestModel:cacheQuery',
            'test label',
            { some: 'data' }
        );
        expect(mockedDebug).not.toHaveBeenCalled();
    });

    test('should pass multiple data arguments to custom logger', () => {
        const customLogger = jest.fn();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                customLogger,
            },
        });

        const debug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_PIPELINE);
        debug('pipeline label', 'arg1', 123, { nested: 'object' });

        expect(customLogger).toHaveBeenCalledWith(
            'speedgoose:TestModel:cachePipeline',
            'pipeline label',
            'arg1',
            123,
            { nested: 'object' }
        );
    });

    test('should use debug library when customLogger is not provided', () => {
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
            },
        });

        const debug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_QUERY);

        expect(mockedDebug).toHaveBeenCalledWith('speedgoose:TestModel:cacheQuery');
        expect(typeof debug).toEqual('function');
    });

    test('should return emptyDebugCallback when debugging is disabled even with customLogger', () => {
        const customLogger = jest.fn();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: false,
                customLogger,
            },
        });

        const debug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_QUERY);

        expect(debug).toBe(emptyDebugCallback);
        expect(customLogger).not.toHaveBeenCalled();
    });

    test('should respect debugModels filter with custom logger', () => {
        const customLogger = jest.fn();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugModels: ['AllowedModel'],
                customLogger,
            },
        });

        const allowedDebug = getDebugger('AllowedModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        const disallowedDebug = getDebugger('DisallowedModel', SpeedGooseDebuggerOperations.CACHE_QUERY);

        allowedDebug('allowed log');
        expect(customLogger).toHaveBeenCalledWith('speedgoose:AllowedModel:cacheQuery', 'allowed log');

        expect(disallowedDebug).toBe(emptyDebugCallback);
    });

    test('should respect debugOperations filter with custom logger', () => {
        const customLogger = jest.fn();
        mockedGetConfig.mockReturnValue({
            redisUri: 'uri',
            debugConfig: {
                enabled: true,
                debugOperations: [SpeedGooseDebuggerOperations.CACHE_QUERY],
                customLogger,
            },
        });

        const allowedDebug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_QUERY);
        const disallowedDebug = getDebugger('TestModel', SpeedGooseDebuggerOperations.CACHE_PIPELINE);

        allowedDebug('allowed log');
        expect(customLogger).toHaveBeenCalledWith('speedgoose:TestModel:cacheQuery', 'allowed log');

        expect(disallowedDebug).toBe(emptyDebugCallback);
    });
});
