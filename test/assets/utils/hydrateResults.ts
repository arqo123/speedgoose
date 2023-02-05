import { ObjectId } from 'mongodb';
import { Query } from 'mongoose';
import { generateTestDocument, generateTestFindQuery } from '../../testUtils';
import { TestModel } from '../../types';

type HydrateResultTestCases = {
    result: TestModel | TestModel[];
    query: Query<TestModel, TestModel>;
};

export const prepareHydrateResultsTestCases = (): HydrateResultTestCases[] => {
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    const id3 = new ObjectId();
    const id4 = new ObjectId();

    return [
        // tc01 - simple raw document
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
                _id: String(id1),
                fieldA: 'tc01',
                name: 'tc01Name',
            },
        },
        // tc02 - document with population of one field
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
                _id: String(id2),
                fieldA: 'tc02',
                name: 'tc02Name',
                relationField: {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                },
            },
        },
        // tc03 - document with population of one field which is array of relations
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
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
                ],
            },
        },
        // tc04 - document with population of one field which is array of relations and with one single relationField
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
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
                },
            },
        },
        // tc05 - result as array of documents
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: [
                {
                    _id: String(id2),
                    fieldA: 'tc02',
                    name: 'tc02Name',
                    relationField: {
                        _id: String(id1),
                        fieldA: 'tc01',
                        name: 'tc01Name',
                    },
                },
                {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                },
                {
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
                    ],
                },
                {
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
                    },
                },
                {
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
                            },
                        },
                    },
                },
            ],
        },
        // tc06 - document with populated only one field, second one stays as a array ids
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
                _id: String(id4),
                fieldA: 'tc04',
                name: 'tc04Name',
                relationArray: [id1, id2],
                relationField: {
                    _id: String(id1),
                    fieldA: 'tc01',
                    name: 'tc01Name',
                },
            },
        },
        // tc07 - document with populated array of record, second relation stays unpopulated
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
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
                relationField: id1,
            },
        },
        // tc08 - document with already hydrated one of the field
        {
            query: generateTestFindQuery({}) as Query<TestModel, TestModel>,
            result: {
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
                relationField: generateTestDocument({
                    fieldA: 'tc01',
                    name: 'tc01Name',
                }),
            },
        },
    ];
};
