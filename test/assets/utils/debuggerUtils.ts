import { SpeedGooseConfig, SpeedGooseDebuggerOperations } from '../../../src/types/types';
import { DEFAULT_DEBUGGER_NAMESPACE } from '../../../src/utils/debugUtils';

type SetupDebuggerTestCases = {
    config: SpeedGooseConfig;
    expectedNamespaces?: string[];
};

export const setupDebuggerTestCases = (): SetupDebuggerTestCases[] =>
    [
        // tc01 all models, all namespaces debugger enabled
        {
            config: {
                debugConfig: {
                    enabled: true,
                },
            },
            expectedNamespaces: ['*:*'],
        },
        // tc02 debugger disabled
        {
            config: {
                debugConfig: {
                    enabled: false,
                },
            },
            expectedNamespaces: [],
        },
        // tc03 no info about debugger in config
        {
            config: {},
            expectedNamespaces: [],
        },
        // tc04 debugger enabled for all models,but for limited operations
        {
            config: {
                debugConfig: {
                    enabled: true,
                    debugOperations: [SpeedGooseDebuggerOperations.CACHE_CLEAR, SpeedGooseDebuggerOperations.CACHE_QUERY],
                },
            },
            expectedNamespaces: [`*:${SpeedGooseDebuggerOperations.CACHE_CLEAR}`, `*:${SpeedGooseDebuggerOperations.CACHE_QUERY}`],
        },
        // tc05 debugger enabled for limited models,but for unlimited operations
        {
            config: {
                debugConfig: {
                    enabled: true,
                    debugModels: ['testModel', 'secondaryTestModel'],
                },
            },
            expectedNamespaces: [`testModel:*`, `secondaryTestModel:*`, `cacheClear:*`],
        },
        // tc06 debugger enabled for limited models and operations
        {
            config: {
                debugConfig: {
                    enabled: true,
                    debugModels: ['testModel', 'secondaryTestModel'],
                    debugOperations: [SpeedGooseDebuggerOperations.CACHE_PIPELINE, SpeedGooseDebuggerOperations.CACHE_QUERY],
                },
            },
            // NOTE -> cacheClear is special 'model' namespace here
            expectedNamespaces: [
                `testModel:${SpeedGooseDebuggerOperations.CACHE_PIPELINE}`,
                `testModel:${SpeedGooseDebuggerOperations.CACHE_QUERY}`,
                `secondaryTestModel:${SpeedGooseDebuggerOperations.CACHE_PIPELINE}`,
                `secondaryTestModel:${SpeedGooseDebuggerOperations.CACHE_QUERY}`,
                `cacheClear:${SpeedGooseDebuggerOperations.CACHE_PIPELINE}`,
                `cacheClear:${SpeedGooseDebuggerOperations.CACHE_QUERY}`,
            ],
        },
    ].map(testCase => ({ ...testCase, expectedNamespaces: testCase.expectedNamespaces.map(namespace => `${DEFAULT_DEBUGGER_NAMESPACE}:${namespace}`) }));
