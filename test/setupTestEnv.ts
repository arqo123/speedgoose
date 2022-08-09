import mongoose from 'mongoose'
import Redis from 'ioredis-mock'
import {applySpeedGooseCacheLayer} from "../src/wrapper";

const config = {
    redisUri: 'redis://localhost:6379'
}

jest.mock('ioredis', () => {
    return function () {
        return new Redis(config)
    };
});

beforeAll(async () => {
    await applySpeedGooseCacheLayer(mongoose, config)
});
