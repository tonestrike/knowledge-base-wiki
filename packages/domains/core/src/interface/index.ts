import { implement } from '@orpc/server';
import { coreContract } from '@package/contracts/core';
import type { Clock } from '@package/shared-kernel';
import { checkHealth } from '../application/check-health.ts';
import { echoPing } from '../application/echo-ping.ts';

export interface CoreContext {
  clock: Clock;
}

const os = implement(coreContract).$context<CoreContext>();

export const coreRouter = {
  health: os.health.handler(({ context }) => {
    const signal = checkHealth({ clock: context.clock });
    return {
      status: signal.status,
      timestamp: signal.timestamp.toISOString(),
    };
  }),
  ping: os.ping.handler(({ input, context }) => {
    const result = echoPing({ clock: context.clock }, input);
    return {
      echo: result.echo,
      receivedAt: result.receivedAt.toISOString(),
    };
  }),
};
