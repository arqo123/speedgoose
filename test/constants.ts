import {SpeedGooseConfig} from "../src/types/types"

export const TEST_MODEL_NAME = 'testModel'

export const TEST_SPEEDGOOSE_CONFIG = <SpeedGooseConfig>{
    redisUri: 'redis://localhost:6379',
    debugConfig: {
        enabled: false
    }
}