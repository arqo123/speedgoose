import { Callback } from 'ioredis';
import Redis from 'ioredis-mock';
import Container from 'typedi';
import { GlobalDiContainerRegistryNames, SpeedGooseRedisChannels } from '../../src/types/types';
import { getRedisInstance, publishRecordIdsOnChannel, registerRedisClient } from '../../src/utils/redisUtils';
import * as commonUtils from '../../src/utils/commonUtils';

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig');
const mockedPublishImplementation = async (channel: string | Buffer, message: string | Buffer, callback?: Callback<number> | undefined) => 1;

describe('getRedisInstance', () => {
    it(`should return access redis instance if redis uri was set in config`, () => {
        mockedGetConfig.mockReturnValue({ redisUri: 'testRedisUri' });
        expect(getRedisInstance()).toBeInstanceOf(Redis);
    });

    it(`should return null if registerRedisClient was not called with uri`, async () => {
        mockedGetConfig.mockReturnValue({});
        Container.remove(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);

        await registerRedisClient(commonUtils.getConfig().redisUri as string);

        expect(getRedisInstance()).toBeNull();
    });
});

describe('publishRecordIdOnChannel', () => {
    it(`should publish message on redis channel when redisUri is in the config`, async () => {
        mockedGetConfig.mockReturnValue({ redisUri: 'testRedisUri' });
        await registerRedisClient(commonUtils.getConfig().redisUri as string);
        const redisInstance = getRedisInstance();

        const mockedPublish = jest.spyOn(redisInstance, 'publish').mockImplementation(mockedPublishImplementation);

        await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, 'someRecordId');
        expect(mockedPublish).toHaveBeenCalled();
    });
});

describe('registerRedisClient', () => {
    it(`should register new service in DiContainer with access to redis instance`, async () => {
        mockedGetConfig.mockReturnValue({ redisUri: 'testRedisUri' });
        await registerRedisClient(commonUtils.getConfig().redisUri as string, commonUtils.getConfig().redisOptions);
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(redisInstance).toBeInstanceOf(Redis);
    });

    it(`should not register new service in DiContainer when redis already exists`, async () => {
        mockedGetConfig.mockReturnValue({ redisUri: 'testRedisUri' });
        await registerRedisClient(commonUtils.getConfig().redisUri as string);
        const redisInstance1 = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(redisInstance1).toBeInstanceOf(Redis);

        await registerRedisClient(commonUtils.getConfig().redisUri as string);
        const redisInstance2 = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(redisInstance2).toEqual(redisInstance1);
        expect(redisInstance2).toBeInstanceOf(Redis);
    });
});

describe('registerRedisClient with pre-built client', () => {
    beforeEach(() => {
        Container.remove(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
    });

    it(`should store the pre-built client as REDIS_GLOBAL_ACCESS`, async () => {
        const existingClient = new Redis();

        await registerRedisClient(undefined, undefined, existingClient);

        const storedInstance = Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(storedInstance).toBe(existingClient);
    });

    it(`should not open a second (subscriber) connection from the pre-built client`, async () => {
        const existingClient = new Redis();
        const duplicateSpy = jest.spyOn(existingClient, 'duplicate');

        await registerRedisClient(undefined, undefined, existingClient);

        expect(duplicateSpy).not.toHaveBeenCalled();
    });

    it(`should ignore redisUri when existingClient is provided`, async () => {
        const existingClient = new Redis();

        await registerRedisClient('some-uri-that-should-be-ignored', undefined, existingClient);

        const storedInstance = Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(storedInstance).toBe(existingClient);
    });

    it(`should not replace existing client on second call (idempotency)`, async () => {
        const existingClient1 = new Redis();
        const existingClient2 = new Redis();

        await registerRedisClient(undefined, undefined, existingClient1);
        await registerRedisClient(undefined, undefined, existingClient2);

        const storedInstance = Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(storedInstance).toBe(existingClient1);
    });
});
