<?php
// api.php - データAPIサーバー（PHP版）
// 設置場所: https://data.yourdomain.com/ai-schedule/api.php
// 外部ライブラリ不要、PHP標準機能のみ

// ========== 設定 ==========
define('DATA_DIR', __DIR__ . '/data');        // データ保存ディレクトリ（api.phpと同じ階層）
define('API_SECRET', getenv('DATA_API_SECRET') ?: 'changeme_secret'); // 必ず変える
$ALLOWED_ORIGINS = array_filter(array_map('trim', explode(',', getenv('ALLOWED_ORIGINS') ?: '')));
// ==========================

// データディレクトリを作成
if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0750, true);
}

// CORSヘッダー
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allow = empty($ALLOWED_ORIGINS) ||
         in_array($origin, $ALLOWED_ORIGINS) ||
         str_ends_with($origin, '.vercel.app');

header('Access-Control-Allow-Origin: ' . ($allow ? $origin : 'null'));
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Secret');
header('Vary: Origin');
header('Content-Type: application/json; charset=utf-8');

// プリフライト
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 認証
$secret = $_SERVER['HTTP_X_API_SECRET'] ?? '';
if ($secret !== API_SECRET) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// userID取得 (?userId=xxx)
$userId = $_GET['userId'] ?? '';
if (!preg_match('/^[a-zA-Z0-9_\-]{1,100}$/', $userId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid userId']);
    exit;
}

$filePath = DATA_DIR . '/' . $userId . '.json';
$method = $_SERVER['REQUEST_METHOD'];

// GET: データ取得
if ($method === 'GET') {
    if (!file_exists($filePath)) {
        http_response_code(404);
        echo json_encode(['error' => 'Not found']);
        exit;
    }
    echo file_get_contents($filePath);
}

// POST: データ保存
elseif ($method === 'POST') {
    $body = file_get_contents('php://input');
    if (strlen($body) > 5 * 1024 * 1024) { // 5MB上限
        http_response_code(413);
        echo json_encode(['error' => 'Body too large']);
        exit;
    }
    $data = json_decode($body, true);
    if (!$data || !is_array($data)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON']);
        exit;
    }
    if (isset($data['userId']) && $data['userId'] !== $userId) {
        http_response_code(400);
        echo json_encode(['error' => 'userId mismatch']);
        exit;
    }

    // 一時ファイルに書いてからリネーム（書き込み中に読まれるのを防ぐ）
    $tmpPath = $filePath . '.tmp';
    file_put_contents($tmpPath, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    rename($tmpPath, $filePath);

    echo json_encode(['success' => true, 'updatedAt' => $data['updatedAt'] ?? null]);
}

// DELETE: データ削除
elseif ($method === 'DELETE') {
    if (file_exists($filePath)) {
        unlink($filePath);
    }
    echo json_encode(['success' => true]);
}

else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
