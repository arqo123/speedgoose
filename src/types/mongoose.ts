import {SpeedGooseCacheOperationParams} from "./types";

declare module 'mongoose' {
    //@ts-expect-error overwriting of mongoose Query interface
    // eslint-disable-next-line @typescript-eslint/ban-types
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = DocType>
        extends Query<any, any> {
        cacheQuery(params?: SpeedGooseCacheOperationParams): Promise<Query<ResultType, Document>>;
        mongooseCollection: Collection,
        //add proper types for operations
        op: string
    }
    //@ts-expect-error overwriting of mongoose Aggregate interface  
    interface Aggregate<R> extends Aggregate<R> {
        cachePipeline(params?: SpeedGooseCacheOperationParams): Promise<R>;
        _model: Model<any>
    }
    // //@ts-expect-error overwriting of mongoose SchemaType interface
    // interface SchemaType extends SchemaType {
    //     //options: SchemaTypeOptions<any>
    // }
    //@ts-expect-error overwriting of mongoose SchemaType interface
    interface Schema extends Schema {
        plugins: {fn: typeof Function, opts:Record<string,never>}[]
    }
}