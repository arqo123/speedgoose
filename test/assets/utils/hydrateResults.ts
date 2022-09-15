import {ObjectId} from "mongodb"
import {Query} from "mongoose"
import {CachedLeanDocument} from "../../../src/types/types"
import {generateTestFindQuery} from "../../testUtils"
import {TestModel} from "../../types"

type HydrateResultTestCases = {
    record: CachedLeanDocument<TestModel>,
    query: Query<TestModel, TestModel>
}

export const prepareHydrateResultsTestCases = (): HydrateResultTestCases[] => {
    const id1 = new ObjectId()
    const id2 = new ObjectId()
    const id3 = new ObjectId()
    const id4 = new ObjectId()

    return [
        // tc01 - simple raw document 
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            record: {
                _id: String(id1),
                fieldA: 'tc01',
                name: 'tc01Name',
            }
        },
        // tc02 - document with population of one field 
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            record: {
                _id: String(id2),
                fieldA: 'tc02',
                name: 'tc02Name',
                relationField: {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                }
            }
        },
        // tc03 - document with population of one field which is array of relations
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            record: {
                _id: String(id3),
                fieldA: 'tc03',
                name: 'tc03Name',
                relationArray: [
                    {
                        _id: String(id1),
                        fieldA: 'tc01',
                        name: 'tc01Name',
                    },
                    {
                        _id: String(id2),
                        fieldA: 'tc02',
                        name: 'tc02Name',
                    },
                ]
            }
        },
        // tc04 - document with population of one field which is array of relations and with one single relationField
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            record: {
                _id: String(id4),
                fieldA: 'tc04',
                name: 'tc04Name',
                relationArray: [
                    {
                        _id: String(id1),
                        fieldA: 'tc01',
                        name: 'tc01Name',
                    },
                    {
                        _id: String(id2),
                        fieldA: 'tc02',
                        name: 'tc02Name',
                    },
                ],
                relationField: {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                }
            }
        },
        // tc05 - document with deeply nested populated records
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            record: {
                _id: String(id4),
                fieldA: 'tc04',
                name: 'tc04Name',
                relationArray: [
                    {
                        _id: String(id1),
                        fieldA: 'tc01',
                        name: 'tc01Name',
                    },
                    {
                        _id: String(id2),
                        fieldA: 'tc02',
                        name: 'tc02Name',
                    },
                ],
                relationField: {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                    relationField: {
                        _id: String(id2),
                        fieldA: 'tc02',
                        name: 'tc02Name',
                        relationField: {
                            _id: String(id3),
                            fieldA: 'tc03',
                            name: 'tc03Name',
                        }
                    }
                }
            }
        },
    ]
}