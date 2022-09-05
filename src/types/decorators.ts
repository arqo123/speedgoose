export const staticImplements = <T>() => <U extends T>(constructor: U) => {constructor};
