import {Aggregate, PipelineStage, ProjectionType, Query, QueryOptions} from 'mongoose'
import {getMongooseInstance} from '../src/utils/mongooseUtils'
import {TEST_MODEL_NAME} from './constants'
import {registerMongooseTestModel} from './setupTestEnv'
import {MongooseTestDocument, MongooseTestModel} from './types'

export const getMongooseTestModel = (): MongooseTestModel =>
    getMongooseInstance()?.models[TEST_MODEL_NAME] ?? registerMongooseTestModel()

export const generateTestAggregate = (pipeline: PipelineStage[]): Aggregate<unknown> =>
    getMongooseTestModel().aggregate(pipeline)

export const generateTestFindQuery = (query: Record<string, unknown>, projection?: ProjectionType<unknown>, options?: QueryOptions): Query<unknown, unknown> =>
    getMongooseTestModel().find(query, projection ?? {}, options ?? {})

export const generateTestDistinctQuery = (query: Record<string, unknown>): Query<unknown, unknown> =>
    getMongooseTestModel().distinct('someField', query)

export const generateTestFindOneQuery = (query: Record<string, unknown>): Query<unknown, unknown> =>
    getMongooseTestModel().findOne(query)

export const generateTestDocument = (value: Record<string, unknown>): MongooseTestDocument => {
    const testModel = getMongooseTestModel()
    const testModelInstance = new testModel(value)

    return testModelInstance
}

export const getValuesFromSet = <T>(set: Set<T>): T[] => Array.from(set).sort()