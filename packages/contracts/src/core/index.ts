import { oc } from '@orpc/contract';
import { z } from 'zod';

const HealthResponse = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});

const PingInput = z.object({
  message: z.string().min(1).max(280),
});

const PingResponse = z.object({
  echo: z.string(),
  receivedAt: z.string().datetime(),
});

export const coreContract = {
  health: oc.route({ method: 'GET', path: '/health' }).output(HealthResponse),
  ping: oc.route({ method: 'POST', path: '/ping' }).input(PingInput).output(PingResponse),
};

export type CoreContract = typeof coreContract;
