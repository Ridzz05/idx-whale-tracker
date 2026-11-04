import OpenAI from "openai";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";

export async function embedMissing(): Promise<{ embedded: number; skipped: boolean }> {
  const env = getEnv();
  if (!env.EMBEDDING_MODEL || !env.LLM_API_KEY) {
    return { embedded: 0, skipped: true };
  }

  const db = getDb();
  const client = new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
  });

  const missingRows = db
    .prepare(
      `SELECT d.id, d.title, d.body
       FROM docs d
       LEFT JOIN doc_vectors v ON v.doc_id = d.id AND v.model = ?
       WHERE v.doc_id IS NULL AND d.kind != 'live'
       ORDER BY d.id ASC`
    )
    .all(env.EMBEDDING_MODEL) as { id: number; title: string; body: string }[];

  if (missingRows.length === 0) {
    return { embedded: 0, skipped: false };
  }

  const upsertVec = db.prepare(`
    INSERT INTO doc_vectors (doc_id, model, dim, vec)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(doc_id) DO UPDATE SET
      model = excluded.model,
      dim = excluded.dim,
      vec = excluded.vec
  `);

  let embedded = 0;
  const batchSize = 64;
  for (let i = 0; i < missingRows.length; i += batchSize) {
    const batch = missingRows.slice(i, i + batchSize);
    const inputs = batch.map((r) => `${r.title}\n${r.body}`.slice(0, 6000));
    const resp = await client.embeddings.create({
      model: env.EMBEDDING_MODEL,
      input: inputs,
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let j = 0; j < batch.length; j++) {
        const vecArr = resp.data[j]?.embedding;
        if (!vecArr) continue;
        const f32 = new Float32Array(vecArr);
        const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
        upsertVec.run(batch[j].id, env.EMBEDDING_MODEL, f32.length, buf);
        embedded += 1;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return { embedded, skipped: false };
}

export async function embedQueryText(query: string): Promise<Float32Array | null> {
  const env = getEnv();
  if (!env.EMBEDDING_MODEL || !env.LLM_API_KEY) return null;
  const client = new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
  });
  const resp = await client.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: query.slice(0, 2000),
  });
  const arr = resp.data[0]?.embedding;
  if (!arr) return null;
  return new Float32Array(arr);
}
