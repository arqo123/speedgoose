declare module 'mongoose' {
    //@ts-expect-error
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = DocType>
        extends DocumentQuery<any, any> {
        cacheQuery(ttl?: number, customKey?: string): Promise<DocumentQuery<ResultType, Document>>;
        mongooseCollection: Collection,
        //add proper types for operations
        op: string
    }
    //@ts-expect-error
    interface Aggregate<R> extends Aggregate<R> {
        cachePipeline(ttl?: number, customKey?: string): Promise<R>;
        _model: Model<any>
    }
}