import {Callback} from "ioredis"
import Redis from "ioredis-mock"
import Container from "typedi"
import {GlobalDiContainerRegistryNames, SpeedGooseRedisChannels} from "../../src/types/types"
import {getRedisInstance, publishRecordIdOnChannel, registerRedisClient} from "../../src/utils/redisUtils"
import * as commonUtils from "../../src/utils/commonUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')
const mockedPublishImplementation = async (channel: string | Buffer, message: string | Buffer, callback?: Callback<number> | undefined) => 1

describe('getRedisInstance', () => {
    it(`should return access redis instance if redis uri was set in config`, () => {
        mockedGetConfig.mockReturnValue({redisUri: 'testRedisUri'})
        expect(getRedisInstance()).toBeInstanceOf(Redis)
    })

    it(`should return null if registerRedisClient was not called with uri`, async () => {
        mockedGetConfig.mockReturnValue({})
        Container.remove(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)

        await registerRedisClient(commonUtils.getConfig().redisUri as string)

        expect(getRedisInstance()).toBeNull()
    })
})

describe('publishRecordIdOnChannel', () => {
    it(`should publish message on redis channel when redisUri is in the config`, async () => {
        mockedGetConfig.mockReturnValue({redisUri: 'testRedisUri'})
        await registerRedisClient(commonUtils.getConfig().redisUri as string)
        const redisInstance = getRedisInstance()

        const mockedPublish = jest.spyOn(redisInstance, 'publish').mockImplementation(mockedPublishImplementation);

        await publishRecordIdOnChannel(SpeedGooseRedisChannels.SAVED_DOCUMENTS, 'someRecordId')
        expect(mockedPublish).toBeCalled()
    })
})

describe('registerRedisClient', () => {
    it(`should register new service in DiContainer with access to redis instance`, async () => {
        mockedGetConfig.mockReturnValue({redisUri: 'testRedisUri'})
        await registerRedisClient(commonUtils.getConfig().redisUri as string)
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)
        expect(redisInstance).toBeInstanceOf(Redis)
    })
})
