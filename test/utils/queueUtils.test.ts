import Container from 'typedi';
import * as Fastq from 'fastq';

import { CacheSetQueuedTask, GlobalDiContainerRegistryNames } from '../../src/types/types';
import { registerInternalQueueWorkers } from '../../src/utils/queueUtils';

const containerSetSpy = jest.spyOn(Container, 'set');

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
