import type { Turn as TurnWire } from '@package/contracts/chat';
import type { TurnId } from '@package/contracts/shared';
import { TurnNotFoundError } from './errors.ts';
import type { ChatDeps } from './ports.ts';

export async function getTurn(deps: ChatDeps, input: { id: TurnId }): Promise<TurnWire> {
  const t = await deps.turns.findById(input.id);
  if (!t) throw new TurnNotFoundError(input.id);
  return deps.turns.toWire(t);
}
