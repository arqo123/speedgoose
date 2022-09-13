import 'jest-extended';
import mongoose, {Schema} from 'mongoose'
import Redis from 'ioredis-mock'
import {applySpeedGooseCacheLayer} from "../src/wrapper";
import {TEST_MODEL_NAME, TEST_SPEEDGOOSE_CONFIG} from './constants';
import Container from 'typedi';

jest.mock('ioredis', () => {
    return function () {
        return new Redis(TEST_SPEEDGOOSE_CONFIG)
    };
});

export const registerMongooseTestModel = () => {
    const schema = new mongoose.Schema({
        name: {type: String},
        tenantId: {type: String},
        fieldA: {type: Schema.Types.Mixed},
        fieldB: {type: Schema.Types.Mixed}
    });

    return mongoose.models[TEST_MODEL_NAME] ?? mongoose.model(TEST_MODEL_NAME, schema);
}

beforeEach(async () => {
    Container.reset()
    await applySpeedGooseCacheLayer(mongoose, TEST_SPEEDGOOSE_CONFIG)
    await registerMongooseTestModel()
});
