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

export type Friend = {
    _id?: string | ObjectId;
    name: string;
    bestFriend?: Friend | string | ObjectId;
};

export type User = {
    _id?: string | ObjectId;
    name: string;
    friends?: (Friend | string | ObjectId)[];
};

export type MongooseTestDocument = Document<string> & TestModel;
export type MongooseFriendDocument = Document<string> & Friend;
export type MongooseUserDocument = Document<string> & User;
export type MongooseTestModel = Model<any>;
