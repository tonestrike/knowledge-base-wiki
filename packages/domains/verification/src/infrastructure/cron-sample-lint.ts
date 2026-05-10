import { lintRunId } from '@package/contracts/shared';
import type { VerificationDeps } from '../application/ports.ts';

export interface DailyLintSampleOptions {
  // 0..1 inclusive — fraction of all known wikis to randomly sample. Default 0.1.
  sampleFraction?: number;
  random?: () => number;
}

// Daily Cron Trigger handler — samples a random subset of all wikis and
// dispatches a LintRun for each. The default 10% sample is per spec §3.1.
// Uses an injected RNG for testability.
export async function dailyLintSample(
  deps: VerificationDeps,
  options: DailyLintSampleOptions = {},
): Promise<{ scheduled: number }> {
  const fraction = options.sampleFraction ?? 0.1;
  const random = options.random ?? Math.random;

  const wikiIds = await deps.claims.listWikiIds();
  if (wikiIds.length === 0) return { scheduled: 0 };

  const sampleSize = Math.max(1, Math.floor(wikiIds.length * fraction));
  const shuffled = [...wikiIds].sort(() => random() - 0.5).slice(0, sampleSize);

  for (const wikiId of shuffled) {
    const id = lintRunId(deps.newId());
    await deps.dispatcher.start({ lintRunId: id, wikiId });
  }

  return { scheduled: shuffled.length };
}
