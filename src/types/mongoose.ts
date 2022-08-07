import {SpeedGooseCacheOperationParams} from "./types";

declare module 'mongoose' {
    //@ts-expect-error
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = DocType>
        extends DocumentQuery<any, any> {
        cacheQuery(params?: SpeedGooseCacheOperationParams): Promise<DocumentQuery<ResultType, Document>>;
        mongooseCollection: Collection,
        //add proper types for operations
        op: string
    }
    //@ts-expect-error
    interface Aggregate<R> extends Aggregate<R> {
        cachePipeline(params?: SpeedGooseCacheOperationParams): Promise<R>;
        _model: Model<any>
    }
    //@ts-expect-error
    interface SchemaType extends SchemaType {
        options: SchemaTypeOptions<any>
    }
}