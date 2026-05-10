import { createCompileRunDOClass } from '@domain/wiki/infrastructure/durable-objects';
import { type WikiBindings, buildCompileRuntimeDeps } from './build-wiki-deps.ts';

export const CompileRunDO = createCompileRunDOClass<WikiBindings>({
  buildDeps: (env, emit) => buildCompileRuntimeDeps(env, emit),
});
