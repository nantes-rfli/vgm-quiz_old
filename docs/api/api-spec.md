# API Spec (VGM Quiz MVP) — v1
- Status: Approved
- Last Updated: 2025-09-16

## この文書の目的
フロントエンド（クイズランナー）とバックエンド（出題/計測API）の**疎結合な契約**を定義する。実装やホスティングの記述は含めない。

## スコープ
- **データプレーン**：問題セットの配信（乱択はサーバ/クライアントいずれでも可）
- **テレメトリプレーン**：計測イベントの受信（PIIなし）

## バージョニング
- パスにバージョンを付与：`/v1/...`
- レスポンスに `schema_version: "1.0"` を含める（将来の後方互換判断用）
- 機能フラグ：`features: { randomizedChoices: boolean }` 等で能力を明示

## 共通
- リクエスト/レスポンス：`Content-Type: application/json; charset=utf-8`
- 認証：本MVPでは不要（将来導入時は `Authorization: Bearer` 等を追加）
- CORS：送信元の最小ホワイトリスト（詳細はサーバ実装側）
- キャッシュ：`ETag/If-None-Match` を `GET` 系で推奨（特に `/manifest`）
- タイムスタンプ：ISO8601（UTC推奨）
- PII：受理しない（短期 `session_id` のみ）

---

## 1. データプレーン

### 1.1 GET `/v1/manifest`
**目的**：利用可能なクイズセットと推奨件数などのメタ情報を返す。  
**クエリ**：なし  
**レスポンス（200）**
```json
{
  "schema_version": "1.0",
  "features": { "randomizedChoices": true },
  "quizSets": [
    { "id": "vgm", "title": "VGM Quiz (Default)", "defaultCount": 10 }
  ]
}
```

**キャッシュ**：`ETag` 推奨（変更時のみ差分取得）

---

### 1.2 GET `/v1/quizzes/{quizId}/next?count=10&seed={sessionId}`

**目的**：次に出題する問題を配列で返す（**各問題は4択**）。
**パス**：`quizId`（例：`vgm`）
**クエリ**

* `count`（省略時10、範囲 1–50）
* `seed`（任意：セッション識別子。乱択の再現性に使用可）
* `locale`（任意：`ja-JP` など。ラベル多言語対応時に使用）

**レスポンス（200）**

```json
{
  "schema_version": "1.0",
  "features": { "randomizedChoices": true },
  "items": [
    {
      "id": "q_0001",
      "prompt": "「Battle Theme X」の作曲者は？",
      "choices": [
        { "id": "composer_ue", "label": "植松 伸夫", "isCorrect": true },
        { "id": "composer_km", "label": "近藤 浩治", "isCorrect": false },
        { "id": "composer_sy", "label": "下村 陽子", "isCorrect": false },
        { "id": "composer_mt", "label": "光田 康典", "isCorrect": false }
      ],
      "sources": [
        { "provider": "ext1", "url": "https://example.com/track1", "priority": 1 },
        { "provider": "ext2", "url": "https://example.com/track1b", "priority": 2 }
      ],
      "backup": false,
      "meta": { "lengthSec": 30, "startSec": 0 }
    }
  ]
}
```

**制約/備考**

* `choices` は**常に4件**、`isCorrect: true` は**ちょうど1件**。
* サーバ側で順序を乱択して返してもよい（`features.randomizedChoices` を `true` にする）。クライアント側での再シャッフルは任意。
* `sources` は**優先度昇順**。クライアントは上位から試行し、全候補不可なら **System Skip** を実行（UX仕様は別文書に準拠）。
* `count` 件を満たせない場合は利用可能な範囲で返す（必要に応じ `204 No Content` も可）。

**ステータス**

* `200 OK`：配列を返却
* `204 No Content`：出題可能な問題が一時的にない
* `400 Bad Request`：パラメータ不正（例：`count` 範囲外）
* `404 Not Found`：`quizId` 不存在
* `429 / 5xx`：制限超過 / サーバエラー

---

## 2. テレメトリプレーン

### 2.1 POST `/v1/metrics`

**目的**：計測イベントの**バッチ**受信（PIIなし）。
**ヘッダ（推奨）**：`Idempotency-Key: <uuid>`（重複投稿の二重計上防止）

**リクエスト（例）**

```json
{
  "schema_version": "1.0",
  "session_id": "sess_20250916_abc123",
  "client": { "app_version": "1.0.0", "platform": "web" },
  "events": [
    {
      "type": "play_start",
      "ts": "2025-09-16T10:00:05.000Z",
      "question_id": "q_0001",
      "ttfs_ms": 520,
      "source": { "provider": "ext1", "url": "https://example.com/track1" }
    },
    {
      "type": "answer_select",
      "ts": "2025-09-16T10:00:10.000Z",
      "question_id": "q_0001",
      "choice_id": "composer_ue",
      "elapsed_ms": 5000
    },
    {
      "type": "answer_result",
      "ts": "2025-09-16T10:00:10.050Z",
      "question_id": "q_0001",
      "is_correct": true,
      "remaining_sec": 7
    },
    {
      "type": "quiz_complete",
      "ts": "2025-09-16T10:02:30.000Z",
      "score": 1234,
      "correct_count": 8
    }
  ]
}
```

**イベント定義（必須フィールド）**

* `play_start`：`question_id`, `ttfs_ms`, `source{provider,url}`
* `answer_select`：`question_id`, `choice_id`, `elapsed_ms`
* `answer_result`：`question_id`, `is_correct`, `remaining_sec`
* `quiz_complete`：`score`, `correct_count`
* 共通：`type`, `ts`（ISO8601）、`session_id`（ルートに含む）

**レスポンス**

```json
{ "accepted": 4 }
```

**ステータス**

* `200 OK`：受理（重複は黙って無害化）
* `400 Bad Request`：スキーマ不正
* `413 Payload Too Large`：サイズ超過
* `429 / 5xx`：制限超過 / サーバエラー

---

## 3. エラーフォーマット（共通）

```json
{
  "error": {
    "code": "bad_request",
    "message": "count must be between 1 and 50",
    "details": { "field": "count" }
  }
}
```

* 代表コード例：`bad_request` / `not_found` / `rate_limited` / `internal`

---

## 4. 型（参考：抜粋）

```ts
type QuizSet = { id: string; title: string; defaultCount: number };

type Choice = { id: string; label: string; isCorrect: boolean };
type Source = { provider: string; url: string; priority: number };

type QuizItem = {
  id: string;
  prompt: string;
  choices: Choice[];              // 4件・isCorrectは1件のみ
  sources: Source[];              // 優先度昇順
  backup: boolean;
  meta?: { lengthSec?: number; startSec?: number };
};
```

---

## 5. ノーテーション

* 本仕様は**クライアント/サーバいずれにも依存しない**中立の契約を意図する。
* 乱択の責務は `features.randomizedChoices` で明示し、クライアントは返却順をそのまま表示してもよい。
