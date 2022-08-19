import 'jest-extended';
import mongoose, {Schema} from 'mongoose'
import Redis from 'ioredis-mock'
import {applySpeedGooseCacheLayer} from "../src/wrapper";
import {TEST_MODEL_NAME, TEST_SPEEDGOOSE_CONFIG} from './constants';

jest.mock('ioredis', () => {
    return function () {
        return new Redis(TEST_SPEEDGOOSE_CONFIG)
    };
});

const registerMongooseTestModel = () => {
    const schema = new mongoose.Schema({
        name: {type: String},
        fieldA: {type: Schema.Types.Mixed},
        fieldB: {type: Schema.Types.Mixed}
    });

    return mongoose.model(TEST_MODEL_NAME, schema);
}

beforeAll(async () => {
    await applySpeedGooseCacheLayer(mongoose, TEST_SPEEDGOOSE_CONFIG)
    await registerMongooseTestModel()
 });
