import type { Artifact, Citation } from '@package/contracts/shared';
import type { UIMessage } from 'ai';

/**
 * Data parts our chat protocol carries on top of the AI SDK's standard
 * `text-part` and `reasoning-part`. Citations and Artifacts don't fit the
 * stock UI Message types (Citation has span/hash/byteRange; Artifact is a
 * closed registry of 8 React component shapes), so they ride as typed
 * `data-citation` and `data-artifact` parts that the dock renders with
 * bespoke React components.
 *
 * `wiki-page-retrieved` surfaces the dispatcher's per-page lookups in the
 * agent-thoughts panel (one entry per page returned by the wiki search).
 *
 * `turn-meta` carries the server-assigned `turnId` so the dock can wire
 * D1 replay and citation-modal links back to the same Turn aggregate.
 */
export type TenexUIMessageDataParts = {
  citation: Citation;
  artifact: Artifact;
  'wiki-page-retrieved': {
    wikiPageId: string;
    title: string;
    pageType?: string;
    citationCount: number;
  };
  'turn-meta': {
    turnId: string;
  };
};

export type TenexUIMessage = UIMessage<unknown, TenexUIMessageDataParts>;
