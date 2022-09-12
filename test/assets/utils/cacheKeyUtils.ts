import {ObjectId} from 'mongodb'
import {Document, Query} from 'mongoose'
import {CachedDocument, SpeedGooseConfig} from "../../../src/types/types"
import {generateTestDocument, generateTestFindQuery} from '../../testUtils'

type GenerateCacheKeyForRecordAndModelNameTestData = {
    given: {
        record: Document
        config: SpeedGooseConfig,
        modelName: string
    },
    expected: string
}

type GenerateCacheKeyForSingleDocumentTestData = {
    given: {
        record: Document,
        query: Query<CachedDocument, CachedDocument>
    },
    expected: string
}

export const generateCacheKeyForRecordAndModelNameTestData = (): GenerateCacheKeyForRecordAndModelNameTestData[] => [
    // t01 - multitenancy with tenant multitenantValue in config
    {
        given: {
            record: generateTestDocument({name: 'tc01', tenantId: 'tentant01'}) as CachedDocument,
            config: {
                multitenancyConfig: {
                    multitenantKey: 'tenantId'
                },
            },
            modelName: 'firstModelName'
        },
        expected: `firstModelName_tentant01`
    },
    // t02 - multitenancy disabled 
    {
        given: {
            record: generateTestDocument({name: 'tc02', tenantId: 'tentant02'}) as CachedDocument,
            config: {},
            modelName: 'firstModelName'
        },
        expected: `firstModelName`
    },

]


export const generateCacheKeyForSingleDocumentTestData = (): GenerateCacheKeyForSingleDocumentTestData[] => {
    const id1 = new ObjectId()
    const id2 = new ObjectId()
    const id3 = new ObjectId()
    const id4 = new ObjectId()

    return [
        // t01 - populate inside query and 
        {
            given: {
                query: generateTestFindQuery({tenantId: 'tenantTestValue'}).populate('modelToPopulate') as Query<CachedDocument, CachedDocument>,
                record: generateTestDocument({_id: id1, name: 'tc01'}),
            },
            expected: `${id1}__modelToPopulate`
        },
        // t02 - selection inside query, selection fields should be sorted
        {
            given: {
                query: generateTestFindQuery({tenantId: 'tenantTestValue'}).select({tenantId: -1, name: 1}) as Query<CachedDocument, CachedDocument>,
                record: generateTestDocument({_id: id2, name: 'tc02'}),
            },
            expected: `${id2}_name:1,tenantId:-1_`
        },
        // t03 - selection and population inside query, selection and population should be sorted
        {
            given: {
                query: generateTestFindQuery({tenantId: 'tenantTestValue'})
                    .select({tenantId: -1, name: 1, fieldA: 1})
                    .populate('secondModelToPopulate')
                    .populate('modelToPopulate') as Query<CachedDocument, CachedDocument>,
                record: generateTestDocument({_id: id3, name: 'tc03'}),
            },
            expected: `${id3}_fieldA:1,name:1,tenantId:-1_modelToPopulate,secondModelToPopulate`
        },
        // t04 - no selection, no population
        {
            given: {
                query: generateTestFindQuery({tenantId: 'tenantTestValue'}) as Query<CachedDocument, CachedDocument>,
                record: generateTestDocument({_id: id4, name: 'tc04'}),
            },
            expected: String(id4)
        },
    ]

}