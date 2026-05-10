import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { systemClock } from '@package/shared-kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildChatContext } from './build-chat-context.ts';
import { router } from './router.ts';

type Env = {
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/rpc/*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error('[orpc]', error);
    }),
  ],
});

// Single-instance chat context: in-memory bindings persist across requests for
// the duration of the worker process. Phase 3 swaps these for D1 + DO.
const chatContext = buildChatContext();

app.use('/rpc/*', async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    context: {
      ...chatContext,
      clock: systemClock,
    },
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

app.get('/', (c) => c.text('tenex api'));

export default app;
