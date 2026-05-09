import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { systemClock } from '@package/shared-kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

app.use('/rpc/*', async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    context: {
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
