/**
 * One-shot: drop the existing wiki for the most-recent folder and
 * re-compile from scratch. Picks up new pipeline behavior (bucket-by-
 * title page explosion, opinionated narrator, glossary) without
 * needing to re-ingest the source PDFs.
 */
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { FolderId, WikiId } from '@package/contracts/shared';

const API = 'https://api.tenex.localhost:1355';
const link = new RPCLink({ url: `${API}/rpc` });
const client = createORPCClient(link) as ContractRouterClient<Contract>;

const wikis = await client.wiki.listWikis({ limit: 1 });
const wiki = wikis.items[0];
if (!wiki) {
  console.error('No wiki to recompile');
  process.exit(1);
}
console.log(`[recompile] dropping wiki ${wiki.id} (folder ${wiki.folderId})`);
await client.wiki.deleteWiki({ id: wiki.id as WikiId });
console.log('[recompile] starting fresh compile…');
const { compileRunId } = await client.wiki.startCompile({ folderId: wiki.folderId as FolderId });
console.log(`[recompile] runId=${compileRunId}`);

// Stream compile events until CompileFinished/CompileFailed.
const resp = await fetch(`${API}/rpc/wiki/streamCompileEvents`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
  body: JSON.stringify({ json: { compileRunId } }),
});
if (!resp.ok || !resp.body) {
  console.error(`[recompile] streamCompileEvents status=${resp.status}`);
  process.exit(1);
}

const start = Date.now();
const decoder = new TextDecoder();
const reader = resp.body.getReader();
let buffered = '';
let pagesDrafted = 0;
let indexesBuilt = 0;
let researchFailed = 0;

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffered += decoder.decode(value, { stream: true });
  let sep = buffered.indexOf('\n\n');
  while (sep >= 0) {
    const frame = buffered.slice(0, sep);
    buffered = buffered.slice(sep + 2);
    const dataLines = frame
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length));
    if (dataLines.length > 0) {
      const payload = dataLines.join('\n');
      if (payload !== '[DONE]') {
        try {
          const env = JSON.parse(payload);
          const e = env?.json ?? env;
          const t = ((Date.now() - start) / 1000).toFixed(1);
          if (e?.kind === 'CompileStarted') {
            console.log(`[${t}s] CompileStarted (${e.sourceCount} sources)`);
          } else if (e?.kind === 'SchemaInferred') {
            console.log(
              `[${t}s] SchemaInferred: ${e.schema.pageTypes.map((p: { name: string }) => p.name).join(', ')}`,
            );
          } else if (e?.kind === 'PageDrafted') {
            pagesDrafted += 1;
            console.log(`[${t}s] PageDrafted: ${e.title} (${e.pageType})`);
          } else if (e?.kind === 'IndexBuilt') {
            indexesBuilt += 1;
            console.log(`[${t}s] IndexBuilt: ${e.pageType} (${e.pageCount} entries)`);
          } else if (e?.kind === 'ResearchFailed') {
            researchFailed += 1;
            console.log(`[${t}s] ResearchFailed: ${e.message}`);
          } else if (e?.kind === 'AgentThought') {
            console.log(`[${t}s] [${e.agent}] ${e.message}`);
          } else if (e?.kind === 'CompileFinished' || e?.kind === 'CompileFailed') {
            console.log(`[${t}s] ${e.kind}${e.kind === 'CompileFailed' ? `: ${e.message}` : ''}`);
            console.log(
              `[recompile] done. pagesDrafted=${pagesDrafted}, indexes=${indexesBuilt}, researchFailed=${researchFailed}`,
            );
            await reader.cancel();
            process.exit(e.kind === 'CompileFinished' ? 0 : 1);
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
    sep = buffered.indexOf('\n\n');
  }
}
console.log('[recompile] stream ended without CompileFinished');
process.exit(2);
