import { lintRunId } from '@package/contracts/shared';
import type { VerificationDeps } from '../application/ports.ts';

export interface DailyLintSampleOptions {
  // 0..1 inclusive — fraction of all known wikis to randomly sample. Default 0.1.
  sampleFraction?: number;
  random?: () => number;
}

export interface DailyLintSampleResult {
  scheduled: number;
  failed: number;
}

// Daily Cron Trigger handler — samples a random subset of all wikis and
// dispatches a LintRun for each. The default 10% sample is per spec §3.1.
// Uses an injected RNG for testability.
//
// Dispatcher rejections are isolated per-wiki via Promise.allSettled — a
// single failure must not halt the remaining wikis (see PR #6
// silent-failure-hunter finding 9). Failed counts are returned and logged so
// the operator notices.
export async function dailyLintSample(
  deps: VerificationDeps,
  options: DailyLintSampleOptions = {},
): Promise<DailyLintSampleResult> {
  const fraction = options.sampleFraction ?? 0.1;
  const random = options.random ?? Math.random;

  const wikiIds = await deps.claims.listWikiIds();
  if (wikiIds.length === 0) return { scheduled: 0, failed: 0 };

  const sampleSize = Math.max(1, Math.floor(wikiIds.length * fraction));
  const shuffled = [...wikiIds].sort(() => random() - 0.5).slice(0, sampleSize);

  const settled = await Promise.allSettled(
    shuffled.map(async (wikiId) => {
      const id = lintRunId(deps.newId());
      await deps.lintDispatcher.start({ lintRunId: id, wikiId });
      return { lintRunId: id, wikiId };
    }),
  );

  let scheduled = 0;
  let failed = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      scheduled++;
    } else {
      failed++;
      console.error('[verification] cron dispatch failed', {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
  return { scheduled, failed };
}
