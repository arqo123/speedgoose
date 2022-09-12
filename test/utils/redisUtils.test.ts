import Redis from "ioredis-mock"
import Container from "typedi"
import {GlobalDiContainerRegistryNames} from "../../src/types/types"
import * as commonUtils from "../../src/utils/commonUtils"
import {getRedisInstance, registerRedisClient} from "../../src/utils/redisUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')

describe('getRedisInstance', () => {
    it(`should return access redis instance if redis uri was set in config`, () => {
        mockedGetConfig.mockReturnValue({redisUri : 'testRedisUri'})
        expect(getRedisInstance()).toBeInstanceOf(Redis)
    })

    it(`should return null if registerRedisClient was not called with uri`, () => {
        mockedGetConfig.mockReturnValue({})
        Container.remove(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)
        
        registerRedisClient(commonUtils.getConfig().redisUri as string)

        expect(getRedisInstance()).toBeNull()
    })
})
