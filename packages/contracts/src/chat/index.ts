import { answersContract } from './answers.ts';
import { conversationsContract } from './conversations.ts';
import { turnsContract } from './turns.ts';

export const chatContract = {
  ...conversationsContract,
  ...turnsContract,
  ...answersContract,
};

export * from './answers.ts';
export * from './conversations.ts';
export * from './mocks.ts';
export * from './turns.ts';
