import { findingsContract } from './findings.ts';
import { lintsContract } from './lints.ts';

export const verificationContract = {
  ...lintsContract,
  ...findingsContract,
};

export * from './findings.ts';
export * from './lints.ts';
export * from './mocks.ts';
