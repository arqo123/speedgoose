import {Document, Model, ObjectId} from 'mongoose'

export type TestModel = {
    name?: string,
    _id?: string | ObjectId,
    fieldA?: string,
    relationField? : TestModel,
    relationArray? : TestModel[]
    [key: string]: unknown
}

export type MongooseTestDocument=  Document<TestModel> & TestModel
export type MongooseTestModel=  Model<any>
