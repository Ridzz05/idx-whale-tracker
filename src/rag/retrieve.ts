import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { embedQueryText } from "./embed";

export interface RetrievedDoc {
  id: number;
  kind: string;
  ref: string;
  title: string;
  snippet: string;
  source_url: string | null;
}

export function buildSafeFtsQuery(raw: string): string {
  const tokens = raw.match(/[\p{L}\p{N}]+/gu) ?? [];
  const cleaned = tokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 24);
  if (cleaned.length === 0) return "";
  return cleaned.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function rrfMerge(
  ftsIds: number[],
  vecIds: number[],
  k: number
): number[] {
  const scores = new Map<number, number>();
  for (let i = 0; i < ftsIds.length; i++) {
    const id = ftsIds[i];
    scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i + 1));
  }
  for (let i = 0; i < vecIds.length; i++) {
    const id = vecIds[i];
    scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i + 1));
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}

export async function retrieve(query: string, k = 8): Promise<RetrievedDoc[]> {
  const db = getDb();
  const limit = Math.max(1, Math.min(30, k));
  const ftsQuery = buildSafeFtsQuery(query);

  let ftsIds: number[] = [];
  if (ftsQuery) {
    const rows = db
      .prepare(
        `SELECT rowid AS id
         FROM docs_fts
         WHERE docs_fts MATCH ?
         ORDER BY bm25(docs_fts, 5.0, 1.0)
         LIMIT ?`
      )
      .all(ftsQuery, Math.max(30, limit * 3)) as { id: number }[];
    ftsIds = rows.map((r) => r.id);
  }

  let vecIds: number[] = [];
  const env = getEnv();
  if (env.EMBEDDING_MODEL && env.LLM_API_KEY) {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM doc_vectors WHERE model = ?`)
      .get(env.EMBEDDING_MODEL) as { cnt: number };
    if (countRow.cnt > 0) {
      try {
        const qVec = await embedQueryText(query);
        if (qVec) {
          const allVecs = db
            .prepare(`SELECT doc_id, dim, vec FROM doc_vectors WHERE model = ?`)
            .all(env.EMBEDDING_MODEL) as {
            doc_id: number;
            dim: number;
            vec: Uint8Array;
          }[];
          const scored: { id: number; sim: number }[] = [];
          for (const row of allVecs) {
            const f32 = new Float32Array(
              row.vec.buffer,
              row.vec.byteOffset,
              Math.floor(row.vec.byteLength / 4)
            );
            scored.push({ id: row.doc_id, sim: cosineSimilarity(qVec, f32) });
          }
          scored.sort((a, b) => b.sim - a.sim);
          vecIds = scored.slice(0, Math.max(30, limit * 3)).map((s) => s.id);
        }
      } catch {
        // Fallback to FTS-only on embedding runtime error
      }
    }
  }

  const topIds =
    vecIds.length > 0 ? rrfMerge(ftsIds, vecIds, limit) : ftsIds.slice(0, limit);

  if (topIds.length === 0) return [];

  const placeholders = topIds.map(() => "?").join(",");
  const docRows = db
    .prepare(
      `SELECT id, kind, ref, title, body, source_url FROM docs WHERE id IN (${placeholders})`
    )
    .all(...topIds) as {
    id: number;
    kind: string;
    ref: string;
    title: string;
    body: string;
    source_url: string | null;
  }[];

  const byId = new Map(docRows.map((d) => [d.id, d]));
  const result: RetrievedDoc[] = [];
  for (const id of topIds) {
    const d = byId.get(id);
    if (!d) continue;
    result.push({
      id: d.id,
      kind: d.kind,
      ref: d.ref,
      title: d.title,
      snippet: d.body.slice(0, 700),
      source_url: d.source_url,
    });
  }
  return result;
}
