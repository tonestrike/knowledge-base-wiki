import { chatRouter } from '@domain/chat/interface';
import { coreRouter } from '@domain/core/interface';
import { ingestionRouter } from '@domain/ingestion/interface';
import { verificationRouter } from '@domain/verification/interface';
import { wikiRouter } from '@domain/wiki/interface';

export const router = {
  core: coreRouter,
  ingestion: ingestionRouter,
  wiki: wikiRouter,
  chat: chatRouter,
  verification: verificationRouter,
};

export type Router = typeof router;
