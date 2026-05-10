import type { Conversation as ConvWire } from '@package/contracts/chat';
import { type ConversationId, conversationId, userId, wikiId } from '@package/contracts/shared';
import type { ConversationRepository } from '../application/ports.ts';
import { Conversation } from '../domain/conversation.ts';

/** Minimal subset of the Cloudflare D1 binding we need. */
export interface D1Like {
  prepare(query: string): {
    bind(...params: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

interface Row {
  id: string;
  wiki_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
}

const toDomain = (r: Row): Conversation => {
  const base = Conversation.open({
    id: conversationId(r.id),
    wikiId: wikiId(r.wiki_id),
    userId: userId(r.user_id),
    createdAt: r.created_at,
  });
  return r.title ? Conversation.withTitle(base, r.title) : base;
};

export const createD1ConversationRepository = (db: D1Like): ConversationRepository => ({
  async insert(c) {
    await db
      .prepare(
        'INSERT INTO conversations (id, wiki_id, user_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(c.id, c.wikiId, c.userId, c.title ?? null, c.createdAt)
      .run();
  },
  async findById(id: ConversationId) {
    const row = await db
      .prepare('SELECT id, wiki_id, user_id, title, created_at FROM conversations WHERE id = ?')
      .bind(id)
      .first<Row>();
    return row ? toDomain(row) : null;
  },
  async list({ wikiId: wid, userId: uid, cursor, limit }) {
    const predicates: string[] = [];
    const params: unknown[] = [];
    if (wid) {
      predicates.push('wiki_id = ?');
      params.push(wid);
    }
    if (uid) {
      predicates.push('user_id = ?');
      params.push(uid);
    }
    if (cursor) {
      predicates.push('created_at < ?');
      params.push(cursor);
    }
    const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
    const sql = `SELECT id, wiki_id, user_id, title, created_at FROM conversations ${where} ORDER BY created_at DESC LIMIT ?`;
    const { results } = await db
      .prepare(sql)
      .bind(...params, limit + 1)
      .all<Row>();
    const items = results.slice(0, limit).map(toDomain);
    const last = results[limit];
    const nextCursor = last ? last.created_at : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  },
  toWire(c): ConvWire {
    return {
      id: c.id,
      wikiId: c.wikiId,
      userId: c.userId,
      ...(c.title !== undefined ? { title: c.title } : {}),
      createdAt: c.createdAt,
    };
  },
});
