import { driveContract } from './drive.ts';
import { ingestEventsContract } from './events.ts';
import { sourcesContract } from './sources.ts';

export const ingestionContract = {
  ...driveContract,
  ...sourcesContract,
  ...ingestEventsContract,
};

export * from './drive.ts';
export * from './events.ts';
export * from './mocks.ts';
export * from './sources.ts';
