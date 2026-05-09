import { describe, expect, it } from 'bun:test';
import { folderId, userId } from '@package/contracts/shared';
import type { FolderId, UserId } from '@package/contracts/shared';
import { listDriveFolders } from './list-drive-folders.ts';
import type { FolderRecord, IngestionDeps } from './ports.ts';
import { registerFolder } from './register-folder.ts';

const baseDeps = (): IngestionDeps => {
  const folders = new Map<string, FolderRecord>();
  return {
    drive: {
      startAuth: async () => ({ state: '', authorizationUrl: '' }),
      completeAuth: async () => {
        throw new Error('n/a');
      },
      listFolders: async ({ query }) => ({
        folders:
          query === 'board'
            ? [
                {
                  driveFolderId: 'd1',
                  name: 'Board governance',
                  modifiedAt: '2026-05-09T12:00:00.000Z',
                },
              ]
            : [],
      }),
      fetch: async () => {
        throw new Error('n/a');
      },
    },
    storage: {} as never,
    sources: {} as never,
    folders: {
      upsert: async (args) => {
        folders.set(args.driveFolderId, {
          id: args.folderId,
          userId: args.userId,
          driveFolderId: args.driveFolderId,
          name: args.name,
        });
      },
      findById: async (id: FolderId) => {
        for (const v of folders.values()) if (v.id === id) return v;
        return null;
      },
    },
    oauth: {} as never,
    oauthState: {} as never,
    eventBus: {
      publish: async () => undefined,
      subscribe: () => () => undefined,
    },
    newId: () => '22222222-2222-4333-8444-555555555555',
    now: () => new Date('2026-05-09T12:00:00.000Z'),
  };
};

describe('listDriveFolders', () => {
  it('proxies to the connector with the requested query and limit', async () => {
    const deps = baseDeps();
    const out = await listDriveFolders(deps, { query: 'board', limit: 20 });
    expect(out.folders).toHaveLength(1);
    expect(out.folders[0]?.name).toBe('Board governance');
  });

  it('returns empty when the connector finds nothing', async () => {
    const deps = baseDeps();
    const out = await listDriveFolders(deps, { query: 'nope', limit: 20 });
    expect(out.folders).toHaveLength(0);
  });
});

describe('registerFolder', () => {
  it('creates a Folder row keyed by drive id and returns the new FolderId', async () => {
    const deps = baseDeps();
    const out = await registerFolder(
      {
        ...deps,
        currentUserId: userId('99999999-2222-4333-8444-555555555555') as UserId,
      },
      { driveFolderId: 'd1', name: 'Board governance' },
    );
    expect(out.folderId).toBe(folderId('22222222-2222-4333-8444-555555555555'));
    const found = await deps.folders.findById(out.folderId);
    expect(found?.driveFolderId).toBe('d1');
    expect(found?.name).toBe('Board governance');
  });
});
