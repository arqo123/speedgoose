import KeyvRedis from "@keyv/redis";
import {CacheClients, CacheNamespaces} from "../../src/types/types";

type CacheClientsTestData = {
    clientName: keyof CacheClients,
    expected: {
        store?: typeof KeyvRedis | typeof Map, 
        namespace: CacheNamespaces
    }
}

export const cacheClientsTestCases: CacheClientsTestData[] = [
    {
        clientName: 'modelsKeyCache',
        expected: {
            store: KeyvRedis,
            namespace: CacheNamespaces.MODELS_KEY_NAMESPACE
        }
    },
    {
        clientName: 'recordsKeyCache',
        expected: {
            store: KeyvRedis,
            namespace: CacheNamespaces.KEY_RELATIONS_NAMESPACE
        }
    },
    {
        clientName: 'hydratedDocumentsCache',
        expected: {
            store: Map,
            namespace: CacheNamespaces.SINGLE_RECORDS_NAMESPACE
        }
    },
    {
        clientName: 'singleRecordsKeyCache',
        expected: {
            store: Map,
            namespace: CacheNamespaces.SINGLE_RECORDS_KEY_NAMESPACE
        }
    },
]