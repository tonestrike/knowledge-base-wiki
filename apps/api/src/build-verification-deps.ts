import { lintWiki } from '@domain/verification';
import {
  createAnthropicVerifier,
  createD1LintFindingRepository,
  createD1LintRunRepository,
  createR2SourceTextReader,
} from '@domain/verification/infrastructure';
import type { VerificationContext } from '@domain/verification/interface';
import type {
  AnthropicVerifier,
  ClaimReader,
  LintFindingRepository,
  LintRunDispatcher,
  LintRunRepository,
  LintRuntimeDeps,
  SourceTextReader,
} from '@domain/verification/ports';
import type {
  Citation,
  Claim,
  ClaimId,
  LintRunId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type { LintEvent } from '@package/contracts/verification';
import type { EventBus } from '@package/shared-kernel';
import { newId } from '@package/shared-kernel';

export interface VerificationBindings {
  DB: D1Database;
  STORAGE: R2Bucket;
  OPEN_ROUTER_API_KEY?: string;
}

const TERMINAL_KINDS: ReadonlySet<LintEvent['kind']> = new Set([
  'LintRunFinished',
  'LintRunFailed',
]);

/**
 * In-process LintRunDispatcher backed by a per-lintRunId in-memory tape.
 * `start` kicks `lintWiki` and resolves immediately so the oRPC handler
 * doesn't block. The use-case writes findings + run rows to D1 as it goes;
 * the tape buffers the LintEvent stream so a slightly-late SSE subscriber
 * (the user clicks "Run audit" then the page renders the stream hook on the
 * next paint) sees every event.
 *
 * For the demo this lives in the api process. The production path is a
 * LintRunDO that holds the same tape per-instance — same protocol, different
 * persistence story.
 */
const createLintDispatcher = (deps: {
  verifier: AnthropicVerifier;
  claims: ClaimReader;
  sourceText: SourceTextReader;
  runs: LintRunRepository;
  findings: LintFindingRepository;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
  concurrency?: number;
}): LintRunDispatcher => {
  interface Tape {
    events: LintEvent[];
    waiters: Array<() => void>;
    finished: boolean;
  }
  const tapes = new Map<LintRunId, Tape>();
  const ensureTape = (id: LintRunId): Tape => {
    const t = tapes.get(id);
    if (t) return t;
    const fresh: Tape = { events: [], waiters: [], finished: false };
    tapes.set(id, fresh);
    return fresh;
  };

  return {
    async start({ lintRunId, wikiId }) {
      const tape = ensureTape(lintRunId);
      const runtimeDeps: LintRuntimeDeps = {
        ...deps,
        concurrency: deps.concurrency ?? 4,
        lintDispatcher: {} as LintRunDispatcher, // unused inside lintWiki
        async emit(event: LintEvent) {
          tape.events.push(event);
          if (TERMINAL_KINDS.has(event.kind)) tape.finished = true;
          const ws = tape.waiters.splice(0);
          for (const w of ws) w();
        },
      };

      // Fire and forget — start resolves immediately so the oRPC handler can
      // return the lintRunId. Errors are routed through the tape as a
      // LintRunFailed event so subscribers see the failure instead of an
      // un-terminated stream.
      lintWiki(runtimeDeps, { lintRunId, wikiId }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        await runtimeDeps.emit({ kind: 'LintRunFailed', lintRunId, message });
      });
    },
    async *subscribe(lintRunId) {
      const tape = ensureTape(lintRunId);
      let cursor = 0;
      while (true) {
        while (cursor < tape.events.length) {
          const ev = tape.events[cursor];
          cursor++;
          if (ev) yield ev;
        }
        if (tape.finished) return;
        await new Promise<void>((resolve) => tape.waiters.push(resolve));
      }
    },
  };
};

export const buildVerificationContext = (
  env: VerificationBindings,
  eventBus: EventBus,
  clock: { now(): Date },
): VerificationContext => {
  const verifier = createAnthropicVerifier({
    apiKey: env.OPEN_ROUTER_API_KEY ?? '',
  });
  const claims = createDirectD1ClaimReader(env.DB);
  const sourceText = createR2SourceTextReader(env.STORAGE);
  const runs = createD1LintRunRepository(env.DB);
  const findings = createD1LintFindingRepository(env.DB);
  const lintDispatcher = createLintDispatcher({
    verifier,
    claims,
    sourceText,
    runs,
    findings,
    eventBus,
    newId,
    now: () => clock.now(),
    concurrency: 4,
  });

  return {
    clock,
    verifier,
    claims,
    sourceText,
    runs,
    findings,
    lintDispatcher,
    eventBus,
    newId,
    now: () => clock.now(),
  } as VerificationContext;
};

// Direct D1 ClaimReader — reads claims + their citations from D1 without
// going through oRPC. Used for the lint pass which needs to enumerate every
// Claim across every WikiPage of a Wiki.
const createDirectD1ClaimReader = (db: D1Database): ClaimReader => ({
  async listWikiIds() {
    const rows = await db.prepare('SELECT id FROM wikis').all<{ id: string }>();
    return rows.results.map((r) => r.id as WikiId);
  },
  async listClaimsForWiki(wikiId: WikiId) {
    const out: Array<{ wikiPageId: WikiPageId; claim: Claim }> = [];
    const pageRows = await db
      .prepare('SELECT id FROM wiki_pages WHERE wiki_id = ?')
      .bind(wikiId)
      .all<{ id: string }>();
    for (const p of pageRows.results) {
      const claimRows = await db
        .prepare('SELECT id, paragraph_id, claim_text FROM claims WHERE wiki_page_id = ?')
        .bind(p.id)
        .all<{ id: string; paragraph_id: string; claim_text: string }>();
      for (const c of claimRows.results) {
        const citeRows = await db
          .prepare(
            'SELECT id, source_id, byte_range_start, byte_range_end, content_hash, label FROM citations WHERE claim_id = ?',
          )
          .bind(c.id)
          .all<{
            id: string;
            source_id: string;
            byte_range_start: number;
            byte_range_end: number;
            content_hash: string;
            label: string;
          }>();
        const citations: Citation[] = citeRows.results.map((r) => ({
          id: r.id as ClaimId & { __brand: 'CitationId' } as never,
          label: r.label,
          span: {
            sourceId: r.source_id as never,
            byteRange: { start: r.byte_range_start, end: r.byte_range_end },
            contentHash: r.content_hash as never,
          },
        }));
        out.push({
          wikiPageId: p.id as WikiPageId,
          claim: {
            id: c.id as ClaimId,
            wikiPageId: p.id as WikiPageId,
            paragraphId: c.paragraph_id,
            claimText: c.claim_text,
            citations,
          } as Claim,
        });
      }
    }
    return out;
  },
});
