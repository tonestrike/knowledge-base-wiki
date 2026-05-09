import { coreRouter } from '@domain/core/interface';

export const router = {
  core: coreRouter,
};

export type Router = typeof router;
