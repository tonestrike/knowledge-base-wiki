import { createChatTurnDOClass } from '@domain/chat';
import { createCompileRunDOClass } from '@domain/wiki/infrastructure/durable-objects';
import { type ChatTurnBindings, buildChatTurnRuntimeDeps } from './build-chat-turn-deps.ts';
import { type WikiBindings, buildCompileRuntimeDeps } from './build-wiki-deps.ts';

export const CompileRunDO = createCompileRunDOClass<WikiBindings>({
  buildDeps: (env, emit) => buildCompileRuntimeDeps(env, emit),
});

export const ChatTurnDO = createChatTurnDOClass<ChatTurnBindings>({
  buildDeps: (env) => buildChatTurnRuntimeDeps(env),
});
