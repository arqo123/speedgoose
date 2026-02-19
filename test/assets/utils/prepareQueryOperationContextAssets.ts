import { Query } from 'mongoose';
import { SpeedGooseCacheOperationContext, SpeedGooseConfig } from '../../../src/types/types';
import { generateTestFindQuery } from '../../testUtils';

type AggregateParamsOperationTestData = {
    given: {
        query: Query<unknown, unknown>;
        config: SpeedGooseConfig;
        params: SpeedGooseCacheOperationContext;
    };
    expected: SpeedGooseCacheOperationContext;
};

export const generateQueryParamsOperationTestData = (): AggregateParamsOperationTestData[] => [
    // t01 - multitenancy with tenant key in query and ttl in params
    {
        given: {
            query: generateTestFindQuery({ tenantId: 'tenantTestValue' }),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                defaultTtl: 30,
            },
            params: {
                ttl: 120,
            },
        },
        expected: {
            ttl: 120,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{},"query":{"tenantId":"tenantTestValue"}}',
            multitenantValue: 'tenantTestValue',
            debug: expect.any(Function),
        },
    },
    // t02 - multitenancy without tenant key in query and with default ttl
    {
        given: {
            query: generateTestFindQuery({}),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{},"query":{}}',
            debug: expect.any(Function),
        },
    },
    // // t03 - multitenancy disabled, tenant key in query and custom key set, debug enabled
    {
        given: {
            query: generateTestFindQuery({}),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                defaultTtl: 30,
            },
            params: {
                cacheKey: 'testCacheKey',
            },
        },
        expected: {
            ttl: 30,
            cacheKey: 'testCacheKey',
            debug: expect.any(Function),
        },
    },
    // // t04 - multitenancy disabled, tenant key in query , projection set as query param
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }, { projectionField1: 1 }),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectionField1":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
        },
    },
    // // t05 - multitenancy disabled, tenant key in query , projection set  with select method
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }).select('selectedField selectedSecondField'),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"selectedField":1,"selectedSecondField":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
        },
    },
    // // t06 - multitenancy disabled, tenant key in query , projection set in options
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }, {}, { projection: { projectedFieldFromOptions: 1 } }),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectedFieldFromOptions":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
        },
    },
    // t07 - multitenancy disabled, tenant key in query , projection set in options, as a param and with select method
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }, { projectedFieldThatWillBeOwerwritten: 1 }, { projection: { projectionFromOptions: 1 } }).select('selectedField'),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectionFromOptions":1,"selectedField":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
        },
    },
    // t08 - force ttl refresh is set in config to true, and not passed in query context
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }, {}, { projection: { projectionFromOptions: 1 } }).select('selectedField'),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                refreshTtlOnRead: true,
                defaultTtl: 30,
            },
            params: {},
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectionFromOptions":1,"selectedField":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
            refreshTtlOnRead: true,
        },
    },
    // t09 - force ttl refresh is set in config to false, and passed in query context
    {
        given: {
            query: generateTestFindQuery({ field1: 'x' }, {}, { projection: { projectionFromOptions: 1 } }).select('selectedField'),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                refreshTtlOnRead: false,
                defaultTtl: 30,
            },
            params: { refreshTtlOnRead: true },
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectionFromOptions":1,"selectedField":1},"query":{"field1":"x"}}',
            debug: expect.any(Function),
            refreshTtlOnRead: true,
        },
    },
    // t10 - query with regexp inside query
    {
        given: {
            query: generateTestFindQuery({ field1: 'x', some: { nested: { object: /Chapter (\d+)\.\d*/ } } }, {}, { projection: { projectionFromOptions: 1 } }).select('selectedField'),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
                debugConfig: {
                    enabled: true,
                },
                refreshTtlOnRead: false,
                defaultTtl: 30,
            },
            params: { refreshTtlOnRead: true },
        },
        expected: {
            ttl: 30,
            cacheKey: '{"collection":"users","mongooseOptions":{},"op":"find","options":{},"projection":{"projectionFromOptions":1,"selectedField":1},"query":{"field1":"x","some":{"nested":{"object":"regex:/Chapter (\\\\d+)\\\\.\\\\d*/"}}}}',
            debug: expect.any(Function),
            refreshTtlOnRead: true,
        },
    },
];
