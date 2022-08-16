import {Aggregate} from "mongoose"
import {SpeedGooseCacheOperationParams, SpeedGooseConfig} from "../../../src/types/types"
import {generateTestAggregate} from "../../testUtils"

type AggregateParamsOperationTestData = {
    given: {
        aggregationPipeline: Aggregate<any>
        config: SpeedGooseConfig,
        params: SpeedGooseCacheOperationParams
    },
    expected: SpeedGooseCacheOperationParams
}

export const generateAggregateParamsOperationTestData = (): AggregateParamsOperationTestData[] => [
    // t01 - multitenancy with tenant multitenantValue in params and ttl in params
    {
        given: {
            aggregationPipeline: generateTestAggregate([{$match: {someField: 'someValue'}}]),
            config: {
                redisUri: 'redisUri',
                multitenancyConfig: {
                    multitenantKey: 'tenantId'
                },
                defaultTtl: 30
            },
            params: {
                ttl: 120,
                multitenantValue: 'tenantTestValue'
            },
        },
        expected: {
            ttl: 120,
            cacheKey: "{\"pipeline\":[{\"$match\":{\"someField\":\"someValue\"}}],\"collection\":\"testmodels\"}",
            multitenantValue: 'tenantTestValue'
        }
    },
    // t02 - multitenancy disable but multitenantValue is set in params  
    {
        given: {
            aggregationPipeline: generateTestAggregate([{$match: {someField: 'someValue'}}]),
            config: {
                redisUri: 'redisUri',
                defaultTtl: 30
            },
            params: {
                multitenantValue: 'tenantTestValue'
            },
        },
        expected: {
            ttl: 30,
            cacheKey: "{\"pipeline\":[{\"$match\":{\"someField\":\"someValue\"}}],\"collection\":\"testmodels\"}",
            multitenantValue: 'tenantTestValue'
        }
    },
    // t03 - multitenancy disable, cacheKey set in params right with ttl
    {
        given: {
            aggregationPipeline: generateTestAggregate([{$match: {someField: 'someValue'}}]),
            config: {
                redisUri: 'redisUri',
                defaultTtl: 30
            },
            params: {
                ttl: 90,
                cacheKey: 'aggregateTestKey'
            },
        },
        expected: {
            ttl: 90,
            cacheKey: "aggregateTestKey",
        }
    },
]