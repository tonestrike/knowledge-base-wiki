export type Brand<T, B extends string> = T & { readonly __brand: B };

declare const crypto: { randomUUID(): string };

export const newId = (): string => crypto.randomUUID();
