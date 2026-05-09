import { describe, expect, it } from 'bun:test';
import { userId } from '@package/contracts/shared';
import type { UserId } from '@package/contracts/shared';
import { completeDriveAuth } from './complete-drive-auth.ts';
import type { IngestionDeps } from './ports.ts';
import { startDriveAuth } from './start-drive-auth.ts';

const fakeDeps = (): IngestionDeps => {
  const tokenStore = new Map<
    UserId,
    { refreshToken: string; accessToken: string; expiresAt: string }
  >();
  const stateStore = new Map<string, { createdAt: string }>();
  return {
    drive: {
      startAuth: async () => ({
        state: 'state-xyz',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-xyz',
      }),
      completeAuth: async (args) => {
        if (args.state !== 'state-xyz') throw new Error('bad state');
        return {
          userId: userId('99999999-2222-4333-8444-555555555555'),
          refreshToken: 'r',
          accessToken: 'a',
          expiresAt: '2026-05-09T13:00:00.000Z',
        };
      },
      listFolders: async () => ({ folders: [] }),
      fetch: async () => {
        throw new Error('not used');
      },
    },
    storage: {} as never,
    sources: {} as never,
    folders: {} as never,
    oauth: {
      saveTokens: async ({ userId: u, ...t }) => {
        tokenStore.set(u, t);
      },
      loadTokens: async (u) => tokenStore.get(u) ?? null,
    },
    oauthState: {
      set: async (s, v) => {
        stateStore.set(s, { createdAt: v.createdAt });
      },
      consume: async (s) => {
        const v = stateStore.get(s);
        stateStore.delete(s);
        return v ?? null;
      },
    },
    eventBus: { publish: async () => undefined, subscribe: () => () => undefined },
    newId: () => '11111111-2222-4333-8444-000000000001',
    now: () => new Date('2026-05-09T12:00:00.000Z'),
  };
};

describe('startDriveAuth', () => {
  it('returns the authorization URL and stores the state', async () => {
    const deps = fakeDeps();
    const out = await startDriveAuth(deps);
    expect(out.authorizationUrl).toContain('accounts.google.com');
    expect(out.state).toBe('state-xyz');
    // state is stored
    const consumed = await deps.oauthState.consume('state-xyz');
    expect(consumed).not.toBeNull();
    expect(consumed?.createdAt).toBe('2026-05-09T12:00:00.000Z');
  });
});

describe('completeDriveAuth', () => {
  it('exchanges the code, persists the tokens, and returns the user id + scopes', async () => {
    const deps = fakeDeps();
    await deps.oauthState.set('state-xyz', {
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    const out = await completeDriveAuth(deps, { code: 'c', state: 'state-xyz' });
    expect(out.userId).toBe(userId('99999999-2222-4333-8444-555555555555'));
    expect(out.scopes).toEqual(['drive.readonly']);
    expect(await deps.oauth.loadTokens(out.userId)).not.toBeNull();
  });

  it('rejects an unknown state', async () => {
    const deps = fakeDeps();
    await expect(completeDriveAuth(deps, { code: 'c', state: 'forged' })).rejects.toThrow(/state/);
  });

  it('consumes the state so the same code cannot be replayed', async () => {
    const deps = fakeDeps();
    await deps.oauthState.set('state-xyz', {
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    await completeDriveAuth(deps, { code: 'c', state: 'state-xyz' });
    await expect(completeDriveAuth(deps, { code: 'c', state: 'state-xyz' })).rejects.toThrow(
      /state/,
    );
  });
});
