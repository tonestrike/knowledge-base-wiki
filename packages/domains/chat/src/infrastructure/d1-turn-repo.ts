import type { Turn as TurnWire } from '@package/contracts/chat';
import { AnswerSegment } from '@package/contracts/shared';
import { type TurnId, conversationId, turnId } from '@package/contracts/shared';
import { z } from 'zod';
import type { TurnRepository } from '../application/ports.ts';
import { Turn } from '../domain/turn.ts';
import type { D1Like } from './d1-conversation-repo.ts';

interface Row {
  id: string;
  conversation_id: string;
  question: string;
  answer_segments_json: string;
  created_at: string;
  finished_at: string | null;
}

const StoredAnswer = z.array(AnswerSegment);

const toDomain = (r: Row): Turn => {
  const segments = StoredAnswer.parse(JSON.parse(r.answer_segments_json));
  let t = Turn.start({
    id: turnId(r.id),
    conversationId: conversationId(r.conversation_id),
    question: r.question,
    createdAt: r.created_at,
  });
  for (const seg of segments) t = Turn.appendSegment(t, seg);
  if (r.finished_at) t = Turn.finish(t, r.finished_at);
  return t;
};

export const createD1TurnRepository = (db: D1Like): TurnRepository => ({
  async insert(t) {
    await db
      .prepare(
        'INSERT INTO turns (id, conversation_id, question, answer_segments_json, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        t.id,
        t.conversationId,
        t.question,
        JSON.stringify(t.answer),
        t.createdAt,
        t.finishedAt ?? null,
      )
      .run();
  },
  async update(t) {
    await db
      .prepare('UPDATE turns SET answer_segments_json = ?, finished_at = ? WHERE id = ?')
      .bind(JSON.stringify(t.answer), t.finishedAt ?? null, t.id)
      .run();
  },
  async findById(id: TurnId) {
    const row = await db
      .prepare(
        'SELECT id, conversation_id, question, answer_segments_json, created_at, finished_at FROM turns WHERE id = ?',
      )
      .bind(id)
      .first<Row>();
    return row ? toDomain(row) : null;
  },
  async list({ conversationId: cid, cursor, limit }) {
    const sql = cursor
      ? 'SELECT id, conversation_id, question, answer_segments_json, created_at, finished_at FROM turns WHERE conversation_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?'
      : 'SELECT id, conversation_id, question, answer_segments_json, created_at, finished_at FROM turns WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?';
    const { results } = cursor
      ? await db
          .prepare(sql)
          .bind(cid, cursor, limit + 1)
          .all<Row>()
      : await db
          .prepare(sql)
          .bind(cid, limit + 1)
          .all<Row>();
    const items = results.slice(0, limit).map(toDomain);
    const last = results[limit];
    const nextCursor = last ? last.created_at : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  },
  toWire(t): TurnWire {
    return {
      id: t.id,
      conversationId: t.conversationId,
      question: t.question,
      answer: [...t.answer],
      createdAt: t.createdAt,
      ...(t.finishedAt !== undefined ? { finishedAt: t.finishedAt } : {}),
    };
  },
});
