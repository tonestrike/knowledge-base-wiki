import {
  type D1Database,
  type DurableObjectNamespace,
  type R2Bucket,
  createCfCompileRunDispatcher,
  createD1CompileRunRepository,
  createD1WikiPageRepository,
  createD1WikiRepository,
  createLlmClient,
  createR2WikiPageStorage,
  createSourceReader,
} from '@domain/wiki/infrastructure';
import type { WikiContext } from '@domain/wiki/interface';
import type { CompileEvent } from '@package/contracts/wiki';
import { type EventBus, InMemoryEventBus } from '@package/shared-kernel';

export interface WikiBindings extends Record<string, unknown> {
  DB: D1Database;
  STORAGE: R2Bucket;
  COMPILE_RUN: DurableObjectNamespace;
  OPEN_ROUTER_API_KEY: string;
}

let cachedBus: EventBus | undefined;
const getBus = (): EventBus => {
  if (!cachedBus) cachedBus = new InMemoryEventBus();
  return cachedBus;
};

// Exposed for other contexts (e.g. chat) that need to publish into the same
// in-process bus the wiki context subscribes against. Keeps cross-context
// events flowing through one canonical instance.
export const getSharedEventBus = (): EventBus => getBus();

// Lazy throwers — for environments (e.g. unit tests against `app.fetch`)
// where the Worker bindings aren't supplied. The handler itself will only
// touch these when a `/rpc/wiki/*` request actually flows through.
const requireBinding = <T>(name: string, value: T | undefined): T => {
  if (value === undefined || value === null) {
    throw new Error(
      `wiki binding '${name}' is missing — set it in wrangler.toml or provide it to the test harness`,
    );
  }
  return value;
};

const baseDeps = (env: Partial<WikiBindings>) => {
  const llm = createLlmClient({
    apiKey: env.OPEN_ROUTER_API_KEY ?? '',
    appName: 'tenex',
    appUrl: 'https://tenex.dev',
  });
  const wikiPageStorage = env.STORAGE ? createR2WikiPageStorage(env.STORAGE) : undefined;
  const wikis = env.DB
    ? createD1WikiRepository(env.DB)
    : (undefined as unknown as ReturnType<typeof createD1WikiRepository>);
  const pages =
    env.DB && wikiPageStorage
      ? createD1WikiPageRepository(env.DB, wikiPageStorage)
      : (undefined as unknown as ReturnType<typeof createD1WikiPageRepository>);
  const runs = env.DB
    ? createD1CompileRunRepository(env.DB)
    : (undefined as unknown as ReturnType<typeof createD1CompileRunRepository>);
  const sources =
    env.DB && env.STORAGE
      ? createSourceReader(env.DB, env.STORAGE)
      : (undefined as unknown as ReturnType<typeof createSourceReader>);
  const dispatcher = env.COMPILE_RUN
    ? createCfCompileRunDispatcher(env.COMPILE_RUN)
    : (undefined as unknown as ReturnType<typeof createCfCompileRunDispatcher>);
  const eventBus = getBus();
  // Surface clear errors when an unwired handler tries to use a missing
  // binding (e.g. `wiki.startCompile` against a test harness with no DO).
  void requireBinding;
  return { llm, sources, wikis, pages, runs, dispatcher, eventBus };
};

// Used by the oRPC handler context. The CompileRunDO uses
// `buildCompileRuntimeDeps` instead — that one wires the per-run `emit`.
export const buildWikiContext = (
  env: Partial<WikiBindings>,
  clock: WikiContext['clock'],
): WikiContext => ({
  ...baseDeps(env),
  clock,
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
});

export const buildCompileRuntimeDeps = (
  env: WikiBindings,
  emit: (e: CompileEvent) => Promise<void>,
) => ({
  ...baseDeps(env),
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
  emit,
});
