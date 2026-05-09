export interface HealthSignal {
  readonly status: 'ok';
  readonly timestamp: Date;
}

export const healthSignal = (timestamp: Date): HealthSignal => ({
  status: 'ok',
  timestamp,
});
