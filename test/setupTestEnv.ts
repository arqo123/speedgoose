import 'jest-extended';
import mongoose from 'mongoose'
import Redis from 'ioredis-mock'
import {applySpeedGooseCacheLayer} from "../src/wrapper";
import {TEST_MODEL_NAME} from './constants';

const config = {
    redisUri: 'redis://localhost:6379'
}

jest.mock('ioredis', () => {
    return function () {
        return new Redis(config)
    };
});

const registerMongooseTestModel = () => {
    const schema = new mongoose.Schema({
        name: {type: String}
    });

    return mongoose.model(TEST_MODEL_NAME, schema);
}

beforeAll(async () => {
    await applySpeedGooseCacheLayer(mongoose, config)
    await registerMongooseTestModel()
});
