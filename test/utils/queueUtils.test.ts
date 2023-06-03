import Container from 'typedi';
import * as Fastq from 'fastq';
import * as queueUtils from '../../src/utils/queueUtils';
import * as commonUtils from '../../src/utils/commonUtils';

import { CacheSetQueuedTask, GlobalDiContainerRegistryNames } from '../../src/types/types';
import { registerInternalQueueWorkers } from '../../src/utils/queueUtils';
import { emptyDebugCallback } from '../../src/utils/debugUtils';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';

const containerSetSpy = jest.spyOn(Container, 'set');
const mockedGetCacheStrategyInstance = jest.spyOn(commonUtils, 'getCacheStrategyInstance');

describe('getCachedSetsQueue', () => {
    it(`should return access to queue of sets`, () => {
        const queueAccess = Container.get<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS);

        expect(queueAccess).toBeInstanceOf(Object);
        expect(typeof queueAccess.push).toEqual('function');
        expect(typeof queueAccess.getQueue).toEqual('function');
    });
});

describe('registerInternalQueueWorkers', () => {
    it(`should register new service in DiContainer with access to queues`, async () => {
        registerInternalQueueWorkers();
        expect(containerSetSpy).toBeCalled();
    });
});

describe('scheduleTTlRefreshing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should not push to the queue if the key is already scheduled', async () => {
        const mockQueue = { push: jest.fn() };
        Container.set<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, mockQueue);
        const setAccess = Container.get<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);

        setAccess.add('key1');

        const context = { cacheKey: 'key1', ttl: 100, debug: emptyDebugCallback };
        const mockedDebug = jest.spyOn(context, 'debug');

        await queueUtils.scheduleTTlRefreshing(context, {});

        expect(mockQueue.push).not.toHaveBeenCalled();
        expect(mockedDebug).not.toHaveBeenCalled();
    });

    it('should push to the queue if the key is not already scheduled', async () => {
        const mockQueue = { push: jest.fn() };
        const queueAccess = Container.set<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, mockQueue);
        const setAccess = Container.get<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);

        setAccess.add('testKey2');

        const context = { cacheKey: 'key1', ttl: 100, debug: emptyDebugCallback };
        const mockedDebug = jest.spyOn(context, 'debug');
        const value = {};
        await queueUtils.scheduleTTlRefreshing(context, value);

        expect(mockQueue.push).toHaveBeenCalledTimes(1);
        expect(mockQueue.push).toHaveBeenCalledWith({ key: context.cacheKey, ttl: context.ttl, value });
        expect(mockedDebug).toHaveBeenCalledWith(`Refreshing TTL time for key ${context.cacheKey}`);
    });

    it('should call refreshTTLForCachedResult on strategy instance', async () => {
        const setAccess = Container.get<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);
        setAccess.add('testKey2');
        const strategyInstance = getCacheStrategyInstance();
        mockedGetCacheStrategyInstance.mockReset();
        const mocked = jest.spyOn(strategyInstance, 'refreshTTLForCachedResult');

        const context = { cacheKey: 'key1', ttl: 100, debug: emptyDebugCallback };
        const value = {};
        await queueUtils.scheduleTTlRefreshing(context, value);

        expect(mockedGetCacheStrategyInstance).toHaveBeenCalledTimes(1);
        expect(mocked).toHaveBeenCalledWith(context.cacheKey, context.ttl, value);
    });
});