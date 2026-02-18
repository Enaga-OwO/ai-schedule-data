// data-server/api/[userId].ts
// ストレージ: Upstash Redis（無料枠 月50万リクエスト）
// Vercel KV より16倍大きい無料枠

import { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

// Upstash Redisクライアント
// 環境変数: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const API_SECRET = process.env.DATA_API_SECRET || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  const allow =
    ALLOWED_ORIGINS.length === 0 ||
    ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", allow ? origin : "null");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Secret");
  res.setHeader("Vary", "Origin");
}

function authenticate(req: VercelRequest): boolean {
  return req.headers["x-api-secret"] === API_SECRET;
}

function extractUserId(url: string): string | null {
  const match = url.match(/\/ai-schedule\/([^/?]+?)(?:\.json)?(?:\?.*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!authenticate(req)) return res.status(401).json({ error: "Unauthorized" });

  const userId = extractUserId(req.url || "");
  if (!userId || userId.length > 100 || /[/\\.]/.test(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const key = `ai_schedule:${userId}`;

  try {
    if (req.method === "GET") {
      const data = await redis.get(key);
      if (data === null) return res.status(404).json({ error: "Not found" });
      return res.status(200).json(data);

    } else if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Invalid body" });
      }
      if (body.userId && body.userId !== userId) {
        return res.status(400).json({ error: "userId mismatch" });
      }
      // TTLなし（永続保存）
      await redis.set(key, body);
      return res.status(200).json({ success: true, updatedAt: body.updatedAt });

    } else if (req.method === "DELETE") {
      await redis.del(key);
      return res.status(200).json({ success: true });

    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error) {
    console.error("Data server error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
