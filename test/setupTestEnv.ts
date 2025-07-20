import 'jest-extended';
import mongoose, { Schema, Model } from 'mongoose';
import Redis from 'ioredis-mock';
import { applySpeedGooseCacheLayer } from '../src/wrapper';
import { TEST_MODEL_NAME, TEST_SPEEDGOOSE_CONFIG } from './constants';
import Container from 'typedi';
import {
    MongooseTestModel,
    MongooseUserDocument,
    MongooseFriendDocument
} from './types';
import { clearTestEventListeners } from './testUtils';

type MongooseUserModel = Model<MongooseUserDocument>;
type MongooseFriendModel = Model<MongooseFriendDocument>;

jest.mock('ioredis', () => {
    return function () {
        return new Redis(TEST_SPEEDGOOSE_CONFIG);
    };
});

export const registerMongooseTestModel = (): MongooseTestModel => {
    const schema = new mongoose.Schema({
        name: { type: String },
        tenantId: { type: String },
        fieldA: { type: Schema.Types.Mixed },
        fieldB: { type: Schema.Types.Mixed },
        relationArray: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: TEST_MODEL_NAME,
            },
        ],
        relationField: {
            type: mongoose.Schema.Types.ObjectId,
            ref: TEST_MODEL_NAME,
        },
    });

    return mongoose.models[TEST_MODEL_NAME] ?? mongoose.model(TEST_MODEL_NAME, schema);
};

export const registerMongooseUserModel = (): MongooseUserModel => {
    const schema = new mongoose.Schema({
        name: { type: String, required: true },
        friends: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Friend',
            },
        ],
    });

    return mongoose.models['User'] ?? mongoose.model('User', schema);
};

export const registerMongooseFriendModel = (): MongooseFriendModel => {
    const schema = new mongoose.Schema({
        name: { type: String, required: true },
        bestFriend: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Friend',
        },
    });

    return mongoose.models['Friend'] ?? mongoose.model('Friend', schema);
};

beforeEach(async () => {
    Container.reset();
    await applySpeedGooseCacheLayer(mongoose, TEST_SPEEDGOOSE_CONFIG);
    await registerMongooseTestModel();
    await registerMongooseUserModel();
    await registerMongooseFriendModel();
});

afterEach(async () => {
    clearTestEventListeners();
});
