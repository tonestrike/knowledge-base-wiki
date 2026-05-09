import { compileContract } from './compile.ts';
import { pagesContract } from './pages.ts';
import { wikisContract } from './wikis.ts';

export const wikiContract = {
  ...wikisContract,
  ...pagesContract,
  ...compileContract,
};

export * from './compile.ts';
export * from './pages.ts';
export * from './wikis.ts';
