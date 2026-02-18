// server.js
// 自前サーバーで動かすデータAPIサーバー
// Node.js のみで動作、外部ライブラリ不要

const http = require("http");
const fs = require("fs");
const path = require("path");

// ========== 設定 ==========
const PORT = 3001;
const DATA_DIR = "/var/data/ai-schedule";   // データ保存先（自由に変えてOK）
const API_SECRET = process.env.DATA_API_SECRET || "changeme_secret"; // 必ず変える
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
// ==========================

// 起動時にデータディレクトリを作成
fs.mkdirSync(DATA_DIR, { recursive: true });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// userIDのバリデーション（パストラバーサル対策）
function isValidUserId(userId) {
  return userId &&
    userId.length <= 100 &&
    /^[a-zA-Z0-9_\-]+$/.test(userId); // 英数字・アンダースコア・ハイフンのみ
}

function getFilePath(userId) {
  return path.join(DATA_DIR, `${userId}.json`);
}

// CORSヘッダーを設定
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allow =
    ALLOWED_ORIGINS.length === 0 ||
    ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(".vercel.app"));

  res.setHeader("Access-Control-Allow-Origin", allow ? origin : "null");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Secret");
  res.setHeader("Vary", "Origin");
}

// リクエストボディを読み込む
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB上限
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// URLから userId を抽出
// /ai-schedule/{userId}.json
function extractUserId(url) {
  const match = url.match(/\/ai-schedule\/([^/?]+?)(?:\.json)?(?:\?.*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  // プリフライトリクエスト
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // 認証
  if (req.headers["x-api-secret"] !== API_SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // /ai-schedule/* 以外は404
  if (!req.url.startsWith("/ai-schedule/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const userId = extractUserId(req.url);
  if (!isValidUserId(userId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid userId" }));
    return;
  }

  const filePath = getFilePath(userId);

  try {
    // GET: データ取得
    if (req.method === "GET") {
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      const data = fs.readFileSync(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
      log(`GET ${userId}`);
    }

    // POST: データ保存
    else if (req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid body" }));
        return;
      }
      if (body.userId && body.userId !== userId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "userId mismatch" }));
        return;
      }

      // 一時ファイルに書いてからリネーム（書き込み途中のファイルが読まれるのを防ぐ）
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2), "utf-8");
      fs.renameSync(tmpPath, filePath);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, updatedAt: body.updatedAt }));
      log(`POST ${userId} (${JSON.stringify(body).length} bytes)`);
    }

    // DELETE: データ削除
    else if (req.method === "DELETE") {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      log(`DELETE ${userId}`);
    }

    else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }

  } catch (error) {
    log(`ERROR: ${error.message}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  log(`データAPIサーバー起動: http://localhost:${PORT}`);
  log(`データ保存先: ${DATA_DIR}`);
  log(`本番環境では必ずNginxでリバースプロキシ + HTTPS化してください`);
});

// プロセス終了時のクリーンアップ
process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT",  () => { server.close(); process.exit(0); });
