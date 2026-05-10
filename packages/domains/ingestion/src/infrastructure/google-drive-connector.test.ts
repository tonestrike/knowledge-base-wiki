import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { userId } from '@package/contracts/shared';
import { createGoogleDriveConnector } from './google-drive-connector.ts';

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  q: string | null;
}

const stubFetch = (handler: (call: FetchCall) => Response): void => {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof URL ? input.toString() : String(input);
    const parsed = new URL(url);
    return handler({ url, q: parsed.searchParams.get('q') });
    // biome-ignore lint/suspicious/noExplicitAny: stubbing the global fetch
  }) as any;
};

describe('createGoogleDriveConnector — C1 listFolders vs listFiles', () => {
  let calls: FetchCall[];
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  const cfg = {
    clientId: 'cid',
    clientSecret: 'client-secret',
    redirectUri: 'https://example.test/cb',
    resolveUserId: () => userId('99999999-2222-4333-8444-555555555555'),
    getCurrentAccessToken: async () => 'access-token',
  };

  it('listFolders queries with mimeType = folder', async () => {
    stubFetch((call) => {
      calls.push(call);
      return new Response(
        JSON.stringify({
          files: [{ id: 'f1', name: 'sub', modifiedTime: '2026-05-09T11:00:00Z' }],
        }),
        { status: 200 },
      );
    });
    const connector = createGoogleDriveConnector(cfg);
    const out = await connector.listFolders({ parentId: 'parent', limit: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.q).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(calls[0]?.q).toContain("'parent' in parents");
    expect(out.folders).toEqual([
      { driveFolderId: 'f1', name: 'sub', modifiedAt: '2026-05-09T11:00:00Z' },
    ]);
  });

  it('listFiles queries with mimeType != folder and returns the parent folder children', async () => {
    stubFetch((call) => {
      calls.push(call);
      return new Response(
        JSON.stringify({
          files: [
            {
              id: 'doc1',
              name: 'q3.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2026-05-09T11:00:00Z',
            },
            {
              id: 'doc2',
              name: 'notes',
              mimeType: 'application/vnd.google-apps.document',
              modifiedTime: '2026-05-09T11:00:00Z',
            },
          ],
        }),
        { status: 200 },
      );
    });
    const connector = createGoogleDriveConnector(cfg);
    const out = await connector.listFiles({ parentId: 'parent', limit: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.q).toContain("mimeType != 'application/vnd.google-apps.folder'");
    expect(calls[0]?.q).toContain("'parent' in parents");
    expect(out.files.map((f) => f.driveFileId)).toEqual(['doc1', 'doc2']);
    // Also surface the per-file MIME so the caller can pre-filter unsupported types.
    expect(out.files[0]?.mimeType).toBe('application/pdf');
  });

  it('SF6: 401 triggers a forced refresh + retry exactly once', async () => {
    let refreshes = 0;
    let attempt = 0;
    stubFetch((call) => {
      calls.push(call);
      attempt++;
      if (attempt === 1) {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(
        JSON.stringify({ files: [{ id: 'f1', name: 'a', modifiedTime: '2026-05-09T11:00:00Z' }] }),
        { status: 200 },
      );
    });
    const connector = createGoogleDriveConnector({
      ...cfg,
      getCurrentAccessToken: async (opts) => {
        if (opts?.forceRefresh) refreshes++;
        return 'token';
      },
    });
    const out = await connector.listFolders({ parentId: 'parent', limit: 10 });
    expect(refreshes).toBe(1);
    expect(out.folders).toHaveLength(1);
  });
});
