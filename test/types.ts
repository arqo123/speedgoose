import { ObjectId } from 'mongodb';
import { Document, Model } from 'mongoose';

export type TestModel = {
    name?: string;
    _id?: string | ObjectId;
    fieldA?: string;
    relationField?: TestModel | string | ObjectId;
    relationArray?: TestModel[] | string[] | ObjectId[];
    [key: string]: unknown;
};

export type MongooseTestDocument = Document<string> & TestModel;
export type MongooseTestModel = Model<any>;
