import { SpeedGooseCacheOperationParams, SpeedGoosePopulateOptions } from './types';

declare module 'mongoose' {
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = unknown, QueryOp = 'find', TDocOverrides = Record<string, never>> {
        cacheQuery(params?: SpeedGooseCacheOperationParams): Promise<ResultType>;
        isCached(params?: SpeedGooseCacheOperationParams): Promise<boolean>;
        /** New method for cached population */
        cachePopulate(options: string | SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]): this;
        mongooseCollection: Collection;
        op: string;
    }
    interface Aggregate<ResultType> {
        cachePipeline(params?: SpeedGooseCacheOperationParams): Promise<ResultType>;
        isCached(params?: SpeedGooseCacheOperationParams): Promise<boolean>;
        _model: Model<unknown>;
    }
    // //@ts-expect-error overwriting of mongoose SchemaType interface
    // interface SchemaType extends SchemaType {
    //     //options: SchemaTypeOptions<any>
    // }
    interface Schema {
        plugins: { fn: typeof Function; opts: Record<string, never> }[];
    }
}
