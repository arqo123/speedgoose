import { SharedCacheStrategies, SpeedGooseConfig } from '../src/types/types';

export const TEST_MODEL_NAME = 'testModel';

export const TEST_SPEEDGOOSE_CONFIG: SpeedGooseConfig & { uri: string } = {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/test',
    redisUri: 'redis://localhost:6379',
    debugConfig: {
        enabled: false,
    },
    sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY,
};
