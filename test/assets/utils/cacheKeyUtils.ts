import { Document } from 'mongoose';
import { SpeedGooseConfig } from '../../../src/types/types';
import { generateTestDocument } from '../../testUtils';

type GenerateCacheKeyForRecordAndModelNameTestData = {
    given: {
        record: Document;
        config: SpeedGooseConfig;
        modelName: string;
    };
    expected: string;
};

export const generateCacheKeyForRecordAndModelNameTestData = (): GenerateCacheKeyForRecordAndModelNameTestData[] => [
    // t01 - multitenancy with tenant multitenantValue in config
    {
        given: {
            record: generateTestDocument({ name: 'tc01', tenantId: 'tentant01' }),
            config: {
                multitenancyConfig: {
                    multitenantKey: 'tenantId',
                },
            },
            modelName: 'firstModelName',
        },
        expected: `firstModelName_tentant01`,
    },
    // t02 - multitenancy disabled
    {
        given: {
            record: generateTestDocument({ name: 'tc02', tenantId: 'tentant02' }),
            config: {},
            modelName: 'firstModelName',
        },
        expected: `firstModelName`,
    },
];
