import {
  createAnthropicVerifier,
  createD1LintFindingRepository,
  createD1LintRunRepository,
  createDirectD1ClaimReader,
  createInMemoryLintRunDispatcher,
  createR2SourceTextReader,
} from '@domain/verification/infrastructure';
import type { VerificationContext } from '@domain/verification/interface';
import type { EventBus, Tracer } from '@package/shared-kernel';
import { newId } from '@package/shared-kernel';

export interface VerificationBindings {
  DB: D1Database;
  STORAGE: R2Bucket;
  OPEN_ROUTER_API_KEY?: string;
}

export const buildVerificationContext = (
  env: VerificationBindings,
  eventBus: EventBus,
  clock: { now(): Date },
  tracer?: Tracer,
): VerificationContext => {
  const verifier = createAnthropicVerifier({
    apiKey: env.OPEN_ROUTER_API_KEY ?? '',
    ...(tracer ? { tracer } : {}),
  });
  const claims = createDirectD1ClaimReader(env.DB);
  const sourceText = createR2SourceTextReader(env.STORAGE);
  const runs = createD1LintRunRepository(env.DB);
  const findings = createD1LintFindingRepository(env.DB);
  const lintDispatcher = createInMemoryLintRunDispatcher({
    verifier,
    claims,
    sourceText,
    runs,
    findings,
    eventBus,
    newId,
    now: () => clock.now(),
    concurrency: 4,
    ...(tracer ? { tracer } : {}),
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
    ...(tracer ? { tracer } : {}),
  } as VerificationContext;
};
