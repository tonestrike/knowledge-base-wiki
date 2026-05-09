import type { Clock } from '@package/shared-kernel';

export interface EchoPingDeps {
  clock: Clock;
}

export interface EchoPingInput {
  message: string;
}

export interface EchoPingOutput {
  echo: string;
  receivedAt: Date;
}

export const echoPing = ({ clock }: EchoPingDeps, { message }: EchoPingInput): EchoPingOutput => ({
  echo: message,
  receivedAt: clock.now(),
});
