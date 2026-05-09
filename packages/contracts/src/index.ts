import { chatContract } from './chat/index.ts';
import { coreContract } from './core/index.ts';
import { ingestionContract } from './ingestion/index.ts';
import { verificationContract } from './verification/index.ts';
import { wikiContract } from './wiki/index.ts';

export const contract = {
  chat: chatContract,
  core: coreContract,
  ingestion: ingestionContract,
  verification: verificationContract,
  wiki: wikiContract,
};

export type Contract = typeof contract;

export * from './chat/index.ts';
export * from './core/index.ts';
export * from './events/index.ts';
export * from './ingestion/index.ts';
export * from './shared/index.ts';
export * from './verification/index.ts';
export * from './wiki/index.ts';
