import {Query} from "mongoose"
import {SpeedGooseCacheOperationContext, SpeedGooseConfig} from "../../../src/types/types"
import {generateTestFindQuery} from "../../testUtils"

type AggregateParamsOperationTestData = {
    given: {
        query: Query<any, any>
        config: SpeedGooseConfig,
        params: SpeedGooseCacheOperationContext
    },
    expected: SpeedGooseCacheOperationContext
}

export const generateQueryParamsOperationTestData = (): AggregateParamsOperationTestData[] => [
    // t01 - multitenancy with tenant key in query and ttl in params
    {
        given: {
            query: generateTestFindQuery({tenantId: 'tenantTestValue'}),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId'
                },
                defaultTtl: 30
            },
            params: {
                ttl: 120,
            },
        },
        expected: {
            ttl: 120,
            cacheKey: "{\"tenantId\":\"tenantTestValue\",\"collection\":\"testmodels\",\"op\":\"find\",\"options\":{}}",
            multitenantValue: 'tenantTestValue'
        }
    },
    // t02 - multitenancy without tenant key in query and with default ttl
    {
        given: {
            query: generateTestFindQuery({}),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId'
                },
                defaultTtl: 30
            },
            params: {
            },
        },
        expected: {
            ttl: 30,
            cacheKey: "{\"collection\":\"testmodels\",\"op\":\"find\",\"options\":{}}"
        }
    },
    // t03 - multitenancy disabled, tenant key in query and custom key set, debug enabled
    {
        given: {
            query: generateTestFindQuery({}),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId'
                },
                debugConfig: {
                    enabled: true
                },
                defaultTtl: 30
            },
            params: {
                cacheKey: 'testCacheKey'
            },
        },
        expected: {
            ttl: 30,
            cacheKey: "testCacheKey",
            debug: expect.any(Function)
        }
    },
]