import { SpeedGooseCacheOperationParams, SpeedGoosePopulateOptions } from './types';

declare module 'mongoose' {
    //@ts-expect-error overwriting of mongoose Query interface
    // eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-unused-vars
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = DocType> extends Query<ResultType, DocType> {
        cacheQuery(params?: SpeedGooseCacheOperationParams): Promise<Query<ResultType, DocType, unknown>>;
        isCached(params?: SpeedGooseCacheOperationParams): Promise<boolean>;
        /** New method for cached population */
        cachePopulate(options: SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]): this;
        mongooseCollection: Collection;
        op: string;
    }
    //@ts-expect-error overwriting of mongoose Aggregate interface
    interface Aggregate<R, ResultType> extends Aggregate<R> {
        cachePipeline(params?: SpeedGooseCacheOperationParams): Promise<R>;
        isCached(params?: SpeedGooseCacheOperationParams): Promise<boolean>;
        _model: Model<unknown>;
    }
    // //@ts-expect-error overwriting of mongoose SchemaType interface
    // interface SchemaType extends SchemaType {
    //     //options: SchemaTypeOptions<any>
    // }
    //@ts-expect-error overwriting of mongoose SchemaType interface
    interface Schema extends Schema {
        plugins: { fn: typeof Function; opts: Record<string, never> }[];
    }
}
