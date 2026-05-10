import {
  citationId,
  claimId,
  compileRunId,
  contentHash,
  folderId,
  sourceId,
  wikiId,
  wikiPageId,
} from '../shared/ids.ts';
import type { WikiSchema } from '../shared/wiki-schema.ts';
import type { CompileEvent } from './compile.ts';
import type { WikiPage } from './pages.ts';
import type { Wiki } from './wikis.ts';

export const demoSchema: WikiSchema = {
  pageTypes: [
    { name: 'Decision', description: 'A board decision recorded with rationale.' },
    { name: 'Metric', description: 'A tracked KPI or financial figure.' },
    { name: 'Person', description: 'A named individual or role.' },
    { name: 'Risk', description: 'A material risk raised in board materials.' },
  ],
  relations: [
    { name: 'DecidedAt', from: 'Decision', to: 'Person', cardinality: 'many-to-one' },
    { name: 'OwnedBy', from: 'Metric', to: 'Person', cardinality: 'many-to-one' },
    { name: 'RaisedIn', from: 'Risk', to: 'Decision', cardinality: 'many-to-many' },
  ],
};

const FOLDER = folderId('22222222-2222-4333-8444-555555555555');
const WIKI = wikiId('44444444-2222-4333-8444-555555555555');
const PAGE = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const RUN = compileRunId('33333333-2222-4333-8444-555555555555');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');
const CIT = citationId('aaaaaaaa-1111-4222-8333-444444444444');

export const mockWiki = (overrides: Partial<Wiki> = {}): Wiki => ({
  id: WIKI,
  folderId: FOLDER,
  schema: demoSchema,
  createdAt: '2026-05-09T11:00:00.000Z',
  updatedAt: '2026-05-09T12:00:00.000Z',
  lastCompiledAt: '2026-05-09T12:00:00.000Z',
  pageCount: 18,
  ...overrides,
});

export const mockWikiPage = (overrides: Partial<WikiPage> = {}): WikiPage => ({
  id: PAGE,
  wikiId: WIKI,
  subtype: 'Concept',
  pageType: 'Decision',
  slug: 'expand-into-emea',
  title: 'Decision: Expand into EMEA in Q4',
  body: '## Context\n\nThe board reviewed the EMEA opportunity in the Q3 meeting.\n\n## Decision\n\nApprove EMEA expansion with a $2M budget cap.',
  claims: [
    {
      id: claimId('cccccccc-1111-4222-8333-444444444444'),
      wikiPageId: PAGE,
      paragraphId: 'p-2',
      claimText: 'The EMEA expansion was approved with a $2M budget cap.',
      citations: [
        {
          id: CIT,
          label: 'Q3 minutes, p.4',
          span: {
            sourceId: SRC,
            byteRange: { start: 1240, end: 1410 },
            contentHash: contentHash('sha256:fb1c4e3a7b0a4dabcdef'),
          },
        },
      ],
    },
  ],
  citations: [
    {
      id: CIT,
      label: 'Q3 minutes, p.4',
      span: {
        sourceId: SRC,
        byteRange: { start: 1240, end: 1410 },
        contentHash: contentHash('sha256:fb1c4e3a7b0a4dabcdef'),
      },
    },
  ],
  backlinks: [],
  updatedAt: '2026-05-09T12:00:00.000Z',
  ...overrides,
});

export async function* mockCompileEventStream(): AsyncIterable<CompileEvent> {
  yield { kind: 'CompileStarted', compileRunId: RUN, folderId: FOLDER, sourceCount: 8 };
  yield {
    kind: 'SchemaInferred',
    compileRunId: RUN,
    schema: demoSchema,
    reason:
      'This folder is about board governance. I will build pages for: Decision, Metric, Person, Risk.',
  };
  yield {
    kind: 'PageDrafted',
    compileRunId: RUN,
    pageId: PAGE,
    subtype: 'Concept',
    pageType: 'Decision',
    title: 'Decision: Expand into EMEA in Q4',
    fromSourceId: SRC,
  };
  yield {
    kind: 'BacklinkResolved',
    compileRunId: RUN,
    fromPageId: PAGE,
    toPageId: wikiPageId('eeeeeeee-1111-4222-8333-444444444444'),
    relationName: 'DecidedAt',
  };
  yield {
    kind: 'IndexBuilt',
    compileRunId: RUN,
    pageType: 'Decision',
    pageCount: 5,
  };
  yield {
    kind: 'CompileFinished',
    compileRunId: RUN,
    wikiId: WIKI,
    pageCount: 18,
  };
}
