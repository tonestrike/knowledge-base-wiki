import type { Clock } from '@package/shared-kernel';
import { type HealthSignal, healthSignal } from '../domain/health.ts';

export interface CheckHealthDeps {
  clock: Clock;
}

export const checkHealth = ({ clock }: CheckHealthDeps): HealthSignal => healthSignal(clock.now());
