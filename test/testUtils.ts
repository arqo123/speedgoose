import mongoose, {Aggregate, PipelineStage, Query, Document} from 'mongoose'
import {getMongooseInstance} from '../src/utils/mongooseUtils'
import {TEST_MODEL_NAME} from './constants'
import {registerMongooseTestModel} from './setupTestEnv'
import {TestModel} from './types'

export const getMongooseTestModel = (): mongoose.Model<TestModel> =>
    getMongooseInstance()?.models[TEST_MODEL_NAME] ?? registerMongooseTestModel()

export const generateTestAggregate = (pipeline: PipelineStage[]): Aggregate<unknown> =>
    getMongooseTestModel().aggregate(pipeline)

export const generateTestFindQuery = (query: Record<string, unknown>): Query<unknown, unknown> =>
    getMongooseTestModel().find(query)

export const generateTestFindOneQuery = (query: Record<string, unknown>): Query<unknown, unknown> =>
    getMongooseTestModel().findOne(query)

export const generateTestDocument = (value: Record<string, unknown>): Document<unknown, unknown> => {
    const testModel = getMongooseTestModel()

    return new testModel(value)
}

export const getValuesFromSet = <T>(set: Set<T>): T[] => Array.from(set).sort()