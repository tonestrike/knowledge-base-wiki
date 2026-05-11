import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const link = new RPCLink({ url: 'https://api.tenex.localhost:1355/rpc' });
const client = createORPCClient(link);

const FOLDER = 'fe560433-fcb7-49a3-bd82-3789d0c51439';
const { compileRunId } = await client.wiki.startCompile({ folderId: FOLDER });
console.log('runId:', compileRunId);

const resp = await fetch('https://api.tenex.localhost:1355/rpc/wiki/streamCompileEvents', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
  body: JSON.stringify({ json: { compileRunId } }),
});
console.log('subscribe status:', resp.status);
if (!resp.body) process.exit(1);
const decoder = new TextDecoder();
const reader = resp.body.getReader();
let buf = '';
const start = Date.now();
while (true) {
  const { value, done } = await reader.read();
  if (done) {
    console.log(`(stream closed after ${((Date.now() - start) / 1000).toFixed(2)}s)`);
    break;
  }
  buf += decoder.decode(value, { stream: true });
  let sep = buf.indexOf('\n\n');
  while (sep >= 0) {
    const frame = buf.slice(0, sep);
    buf = buf.slice(sep + 2);
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .join('\n');
    if (data) {
      try {
        const env = JSON.parse(data);
        const e = env?.json ?? env;
        const t = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`[${t}s]`, JSON.stringify(e).slice(0, 200));
      } catch {}
    }
    sep = buf.indexOf('\n\n');
  }
}
