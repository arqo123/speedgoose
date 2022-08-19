import mongoose, {Aggregate, PipelineStage, Query, Document} from 'mongoose'
import {getMongooseInstance} from '../src/utils/mongooseUtils'
import {TEST_MODEL_NAME} from './constants'
import {TestModel} from './types'

export const getMongooseTestModel = (): mongoose.Model<TestModel> => getMongooseInstance().models[TEST_MODEL_NAME]

export const generateTestAggregate = (pipeline: PipelineStage[]): Aggregate<any> =>
    getMongooseTestModel().aggregate(pipeline)

export const generateTestFindQuery = (query: Record<string, unknown>): Query<any, any> =>
    getMongooseTestModel().find(query)

export const generateTestFindOneQuery = (query: Record<string, unknown>): Query<any, any> =>
    getMongooseTestModel().findOne(query)

export const generateTestDocument = (value: Record<string, unknown>): Document<any, any> => {
    const testModel = getMongooseTestModel()

    return new testModel(value)
}