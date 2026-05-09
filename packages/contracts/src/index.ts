import { coreContract } from './core/index.ts';

export const contract = {
  core: coreContract,
};

export type Contract = typeof contract;

export * from './core/index.ts';
