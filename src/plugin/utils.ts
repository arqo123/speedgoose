import {Document} from "mongoose"
import {SpeedGooseCacheAutoCleanerOptions} from "../types/types"

export const wasRecordDeleted = <T>(record: Document<T>, options: SpeedGooseCacheAutoCleanerOptions): boolean => {
    if (record && options?.wasRecordDeletedCallback) {
        return options.wasRecordDeletedCallback(record)
    }

    return false
}
