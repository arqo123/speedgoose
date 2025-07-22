import mongoose, { Aggregate, PipelineStage, ProjectionType, QueryOptions } from 'mongoose';
import { clearAllCaches } from '../src/utils/cacheUtils';
import { SpeedGooseRedisChannels } from '../src/types/types';
import { getRedisListenerInstance } from '../src/utils/redisUtils';
import { MongooseTestDocument, MongooseTestModel } from './types';
import { getMongooseInstance } from '../src/utils/mongooseUtils';
import { TEST_MODEL_NAME } from './constants';
import { registerMongooseTestModel } from './setupTestEnv';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SpeedGooseCacheAutoCleaner } from '../src/plugin/SpeedGooseCacheAutoCleaner';

let mongoServer: MongoMemoryServer;

export const getTestDBUri = async (): Promise<string> => {
    if (!mongoServer) {
        mongoServer = await MongoMemoryServer.create();
    }
    return mongoServer.getUri();
};

export const UserSchema = new mongoose.Schema({
    name: String,
    email: String,
    age: Number,
    fieldA: String,
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    parents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    relationField: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    relationArray: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

UserSchema.plugin(SpeedGooseCacheAutoCleaner)

export const UserModel = mongoose.model('User', UserSchema);

export const getMongooseTestModel = (): MongooseTestModel => getMongooseInstance()?.models[TEST_MODEL_NAME] ?? registerMongooseTestModel();

export const setupTestDB = async () => {
    const uri = await getTestDBUri();
    await mongoose.connect(uri);
    if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
    }
};

export const clearTestCache = async () => {
    await clearAllCaches();
};

 
/**
 * Generates a test query for findOne operations
 */
export const generateTestFindOneQuery = (conditions: Record<string, any>) => {
    return UserModel.findOne(conditions) as any;
};

/**
 * Generates a test query for find operations
 */
export const generateTestFindQuery = (conditions: Record<string, any>, projection?: ProjectionType<unknown>, options?: QueryOptions) => {
    return UserModel.find(conditions, projection ?? {}, options ?? {}) as any;
};
 
/**
 * Generates a test query for distinct operations
 */
export const generateTestDistinctQuery = (field: string) => {
    return UserModel.distinct(field) as any;
};

/**
 * Generates a test query for aggregate operations
 */
export const generateTestAggregateQuery = (pipeline: any[]) => {
    return UserModel.aggregate(pipeline) as any;
};


export const generateTestDocument = (value: Record<string, unknown>): MongooseTestDocument => {
    const testModel = getMongooseTestModel();
    const testModelInstance = new testModel(value);

    return testModelInstance;
};

export const generateTestAggregate = (pipeline: PipelineStage[]): Aggregate<unknown, unknown[]> => getMongooseTestModel().aggregate(pipeline);
 
export const getValuesFromSet = <T>(set: Set<T>): T[] => Array.from(set).sort();

export const clearTestEventListeners = (): void => {
    getMongooseTestModel().removeAllListeners();
    getRedisListenerInstance()?.removeAllListeners(SpeedGooseRedisChannels.RECORDS_CHANGED);
};

export const wait = (ms: number): Promise<unknown> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};