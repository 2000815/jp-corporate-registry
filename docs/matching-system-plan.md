# 法人名寄せシステム「corporation-matching」詳細設計計画 v5

作成日: 2026-03-20
改訂履歴:
- v1: 初版（MCP構成）
- v2: MCP廃止・ハイブリッド処理・検索ロジック詳細化
- v3: コードレベルGotchas対応（SET LOCAL・コア名称ノイズ・並行処理制御）
- v4: AIをVertex AI Gemini（GCP統合）に変更、Terraform管理追加
- v5: 既存コードとの整合性検証・設計レビュー反映・欠落要件補完

---

## 設計変更サマリー（v4 → v5）

| 項目 | v4 | v5 |
|------|----|----|
| DB接続 | プール max=10（暗黙の仮定） | postgres ドライバに明示的 `max: 10` 設定を追加 |
| DB並行制御 | p-limitのみ | p-limit + Case C内DB呼び出しもdbLimit経由に変更 |
| CSV出力順序 | 完了順（順序不定） | 入力順序を保証（結果バッファ方式） |
| 信頼度スコア | Step A/Bのパスが未定義 | Step A=100, Step B=95 を明示的に定義 |
| チェックポイント | 「10行毎」（曖昧） | 完了行数ベース + JSONファイル仕様を定義 |
| エラーハンドリング | 未定義 | 行単位スキップ + エラーログ方針を追加 |
| 閉鎖法人 | 減点のみ | 承継先法人の自動追跡を追加 |
| 法人番号 | 13桁チェックのみ | チェックディジット検証を追加 |
| Step B複数一致 | 未定義 | 都道府県・住所で絞り込み → AI Case Bへ |
| リポジトリ構成 | 別リポジトリ前提 | corporation-search-api 内のサブディレクトリとして構成 |
| pg_trgm前提条件 | 暗黙 | 拡張有効化の確認手順を追加 |
| ログ・可観測性 | なし | 進捗ログ・処理統計の設計を追加 |
| --dry-run | 仕様未定義 | DB検索のみ実行・AI呼び出しスキップと定義 |

---

## 1. 要件定義書

### 1.1 システム目的

国税庁法人番号DBを基盤として、顧客が持つ企業リスト（CSV）を国税庁の正式法人レコードに名寄せ（マッチング）する。データクレンジング・与信管理・顧客マスタ統合などの業務用途を想定。

### 1.2 機能要件

| 機能ID | 機能名 | 概要 |
|--------|--------|------|
| F-01 | CSV入力読み込み | UTF-8/Shift-JIS自動判定、ヘッダー正規化 |
| F-02 | 入力クレンジング | 文字統一・法人格正規化・都道府県抽出 |
| F-03 | 個人/法人判定（ローカル） | 正規表現ルールベースで判定 |
| F-04 | 法人番号直接検索 | 13桁チェックディジット検証 → DB照合・確定 |
| F-05 | 完全一致検索 | 正規化後の名称でDB完全一致検索（複数一致時の絞り込み含む） |
| F-06 | pg_trgm段階的ファジー検索 | 都道府県フィルター付き → なし → コア名称の段階的検索 |
| F-07 | AI候補評価（Case B） | 絞れない候補をAIが評価・選択（DB再検索なし） |
| F-08 | AI再検索（Case C） | 全不一致の場合のみAIがfunction callingで再検索 |
| F-09 | 信頼度スコアリング | 各マッチに信頼度0〜100を付与（全Stepに対応） |
| F-10 | 自動確定／要確認分類 | 閾値に従いアウトカム分類 |
| F-11 | 閉鎖法人承継先追跡 | closeDate + successorCorporateNumberがある場合、承継先を自動検索 |
| F-12 | CSV出力 | 入力+マッチング結果をCSVで出力（入力行順序保証） |
| F-13 | Excel出力 | 5シート・色分け・AutoFilter付きExcel出力 |
| F-14 | チェックポイント | 処理中断後の再開機能（JSONファイル方式） |
| F-15 | 並行処理制御 | p-limitによるDB・AI別の同時実行数管理 |
| F-16 | セキュリティ確認ゲート | 個人情報送信前の同意確認 |
| F-17 | 入力フォーマットテンプレート出力 | `--template` オプションで入力CSVのヘッダー・サンプル行をダウンロード |
| F-18 | 進捗ログ・処理統計 | 処理進捗のリアルタイム表示と完了時の統計レポート |
| F-19 | エラー行スキップ | 1行の処理失敗で全体を停止させず、エラーログに記録して続行 |

### 1.3 非機能要件

| 項目 | 要件 | 根拠 |
|------|------|------|
| 処理性能 | 1,000行を15分以内 | AI並行数5 × 2秒/件 × 250件 ÷ 60 ≈ 14分 |
| コスト効率 | AI呼び出しは全体の30%以下 | ローカル処理70%以上を目標 |
| DB安全性 | 既存APIへの影響ゼロ | SET LOCAL でセッション変数を隔離 |
| DB同時接続 | 最大10接続（名寄せ専用プール） | db-g1-smallのmax_connections≈25。既存API用に15本を確保 |
| 再現性 | AI呼び出し時はtemperature=0固定 | — |
| セキュリティ | 個人情報のAPI送信前に確認ゲートを設置 | — |
| 出力順序 | CSV/Excelの出力行順序は入力CSVの行順序と一致すること | ユーザーが入力と突合できるため |
| エラー耐性 | 1行の処理失敗が全体を停止させないこと | バッチ処理の信頼性 |

### 1.4 入力仕様

```
CSVカラム（ヘッダーあり）:
  input_id          : 任意識別子（空可）
  corporate_number  : 法人番号13桁（空可）
  company_name      : 会社名（null/不明/空文字 可）
  address           : 所在地（空可）
  phone             : 電話番号（空可）

文字コード: UTF-8 / Shift-JIS（自動判定）
改行: LF / CRLF 両対応
```

#### テンプレートCSVの内容（`--template` で出力されるファイル）

```csv
input_id,corporate_number,company_name,address,phone
1,,株式会社サンプル,東京都渋谷区道玄坂1-1-1,03-1234-5678
2,1234567890123,東京サンプル有限会社,,
3,,サンプル商事,大阪府大阪市北区梅田1-1,
4,,,東京都新宿区,,
5,,不明,,090-1234-5678
```

- 1行目: ヘッダー（固定）
- 2〜6行目: 各パターンのサンプルデータ（説明用・処理前に削除すること）
- 出力先: `--output` で指定したパス、省略時はカレントディレクトリに `matching_template.csv`

```bash
# 使い方
npx corporation-matching --template
npx corporation-matching --template --output ./input/
```

### 1.5 セキュリティ前提条件（実装前に確認・合意必須）

- Vertex AI（Google Cloud）はAPIデータをデフォルトでモデル学習に使用しない（GCPデータ処理規約を確認）
- 社内コンプライアンス部門との事前合意
- `--no-ai` オプションでAI完全無効化モードを提供
- AIに送信するデータは会社名・住所のみに絞ること（電話番号・担当者名は送らない）

### 1.6 GCPインフラ管理方針

Terraform（既存の `corporation-search-api/terraform/`）で以下を一元管理する：

| リソース | 内容 |
|---------|------|
| `aiplatform.googleapis.com` | Vertex AI API の有効化（既にmain.tfに追加済み） |
| `google_service_account.matching` | 名寄せシステム専用SA（既にmain.tfに追加済み） |
| `roles/aiplatform.user` | GeminiへのアクセスをSAに付与（既にmain.tfに追加済み） |
| `roles/cloudsql.client` | Cloud SQL読み取りをSAに付与（既にmain.tfに追加済み） |

認証フロー：
- **ローカル実行**: `gcloud auth application-default login` で開発者自身のADCを使用
- **自動化実行**: `corporation-matching` サービスアカウントを使用

### 1.7 CLIオプション仕様

| オプション | 必須 | 説明 |
|-----------|------|------|
| `--input <path>` | Yes（`--template`時を除く） | 入力CSVファイルパス |
| `--output <path>` | No | 出力先ディレクトリ（デフォルト: カレント） |
| `--format csv\|excel\|both` | No | 出力形式（デフォルト: both） |
| `--resume` | No | チェックポイントから再開 |
| `--no-ai` | No | AI呼び出しを完全無効化（ローカル検索のみ） |
| `--dry-run` | No | DB検索のみ実行、AI呼び出しスキップ、結果をCSVに出力 |
| `--template` | No | 入力CSVテンプレートを出力して終了 |
| `--verbose` | No | 詳細ログ出力（各行の検索過程を表示） |

---

## 2. システム設計

### 2.1 全体アーキテクチャ

```
入力CSV
  ↓
+-----------------------------------------------------------+
|  corporation-matching  (単一Node.jsプロセス)              |
|                                                           |
|  [Step 1] CSV読み込み・前処理（全行）                    |
|    - エンコーディング判定・パース                        |
|    - 会社名正規化 / コア名称生成                        |
|    - 都道府県抽出                                        |
|    - 個人/法人判定                                       |
|    - 法人番号チェックディジット検証                      |
|                                                           |
|  [Step 2] 並行バッチ処理                                 |
|    ┌─────────────────────────────────────────┐           |
|    │  p-limit: DB並行数=10、AI-B並行数=5、AI-C並行数=3  │|
|    │                                                     │|
|    │  各行に対して:                                      │|
|    │    A: 法人番号直接検索        → 確定               │|
|    │    B: 完全一致検索            → 確定 or 候補        │|
|    │    C: pg_trgm + 都道府県      → 確定 or 候補        │|
|    │    D-1: pg_trgm 都道府県なし  → 確定 or 候補        │|
|    │    D-2: コア名称（5文字以上） → 確定 or 候補        │|
|    │       ↓ 候補あり                                   │|
|    │    AI Case B: 候補評価（DB検索なし）                │|
|    │       ↓ 候補なし                                   │|
|    │    AI Case C: function calling で再検索             │|
|    │              （DB呼び出しもdbLimit経由）            │|
|    └─────────────────────────────────────────┘           |
|                                                           |
|  [Step 3] 出力生成                                       |
|    - 入力行順序でソートして出力                          |
|    - CSV / Excel出力                                     |
|    - チェックポイント更新                                |
|    - 処理統計レポート                                    |
+-----------------------------------------------------------+
           ↕ Drizzle ORM（直接接続・読み取り専用）
+-----------------------------------------------------------+
|  Cloud SQL (PostgreSQL 14)  [db-g1-small]                |
|  コネクションプール: max=10（名寄せ専用）                |
|  - corporation テーブル（国税庁全法人・約500万件）       |
|  - GIN trgmインデックス                                 |
|  注意: 既存API（Cloud Run）と共有インスタンス            |
|  → max_connections ≈ 25 のうち15本をAPI用に確保         |
+-----------------------------------------------------------+
```

### 2.2 リポジトリ構成

名寄せシステムは既存の `corporation-search-api` リポジトリ内にサブディレクトリとして構成する。DBスキーマ・接続コード・Terraform設定を共有するため。

```
corporation-search-api/
├── src/                          # 既存API（変更なし）
├── terraform/                    # 既存Terraform（SA追加済み）
│
├── matching/                     # ★ 名寄せシステム（新規）
│   ├── package.json              # 独自の依存関係
│   ├── tsconfig.json
│   ├── .env.example
│   │
│   ├── src/
│   │   ├── index.ts              # CLIエントリポイント
│   │   │
│   │   ├── normalizer/
│   │   │   ├── company-name.ts   # 会社名正規化・コア名称生成
│   │   │   ├── address.ts        # 住所正規化・都道府県抽出
│   │   │   └── corporate-number.ts # 法人番号クレンジング・チェックディジット
│   │   │
│   │   ├── classifier/
│   │   │   └── entity-type.ts    # 個人/法人/不明の判定
│   │   │
│   │   ├── searcher/
│   │   │   ├── index.ts          # 検索オーケストレーター（Step A〜D）
│   │   │   ├── direct-search.ts  # Step A: 法人番号直接検索
│   │   │   ├── exact-search.ts   # Step B: 完全一致検索
│   │   │   ├── trgm-search.ts    # Step C/D: pg_trgm（SET LOCAL含む）
│   │   │   └── confidence.ts     # 信頼度スコア算出
│   │   │
│   │   ├── ai/
│   │   │   ├── client.ts         # Vertex AIクライアント初期化・callVertexWithRetry
│   │   │   ├── evaluate-candidates.ts # Case B: 候補評価
│   │   │   └── search-with-ai.ts # Case C: function calling
│   │   │
│   │   ├── db/
│   │   │   └── index.ts          # DB接続（既存パターン流用 + max:10 明示）
│   │   │
│   │   ├── io/
│   │   │   ├── csv-reader.ts     # 入力CSV（エンコーディング自動判定）
│   │   │   ├── csv-writer.ts     # CSV出力
│   │   │   └── excel-writer.ts   # Excel出力（ExcelJS）
│   │   │
│   │   ├── batch/
│   │   │   ├── processor.ts      # p-limitによる並行バッチ処理
│   │   │   ├── checkpoint.ts     # 進捗保存・再開
│   │   │   └── logger.ts         # 進捗ログ・処理統計
│   │   │
│   │   └── types.ts              # 共有型定義
│   │
│   ├── tests/
│   │   ├── normalizer/
│   │   │   ├── company-name.test.ts
│   │   │   └── address.test.ts
│   │   ├── classifier/
│   │   │   └── entity-type.test.ts
│   │   └── searcher/
│   │       └── confidence.test.ts
│   │
│   └── samples/
│       ├── input_sample.csv
│       └── expected_output_sample.csv
```

### 2.3 既存インデックスの整理（schema.tsより確認済み）

| インデックス名 | 種類 | 対象 | 用途 |
|--------------|------|------|------|
| `corporation_name_trgm_idx` | GIN (gin_trgm_ops) | name | `%` 演算子によるsimilarity検索 ← 主力 |
| `corporation_name_lower_idx` | B-tree | lower(name) | 完全一致検索（Step B） |
| `corporation_name_lower_pattern_idx` | B-tree (text_pattern_ops) | lower(name) | LIKE '前方一致%' |
| `corporation_search_order_idx` | B-tree (composite) | lower(name), corporate_number | ソート済み検索用 |

**重要制約**:
- `dom_prefecture`（都道府県）にインデックスは**存在しない**
- 都道府県フィルターは必ずtrgm条件の**後**に適用する（逆順は全表スキャンになる）
- Step D（都道府県なし）ではthreshold=0.7以上を必須とする（500万件スキャンのリスク）

### 2.4 前提条件確認事項（実装開始前に必須）

| # | 確認事項 | 確認方法 | 影響 |
|---|---------|---------|------|
| PRE-01 | pg_trgm拡張が有効か | `SELECT * FROM pg_extension WHERE extname = 'pg_trgm';` | 無効なら `CREATE EXTENSION pg_trgm;` が必要 |
| PRE-02 | similarity()関数が動作するか | `SELECT similarity('テスト', 'テスト株式会社');` | GINインデックスが使えるか |
| PRE-03 | DB max_connections | `SHOW max_connections;` | 名寄せ用10本の確保可否 |
| PRE-04 | 既存APIの平均接続数 | Cloud SQL Monitoring | 競合リスクの定量化 |

---

## 3. 検索ロジック詳細設計（最重要）

### 3.1 処理全体フロー

```
入力1行
  │
  ▼
【前処理】
  ├─ 法人番号クレンジング（ハイフン除去・13桁確認・チェックディジット検証）
  ├─ 会社名正規化 → normalized_name
  ├─ コア名称生成（法人格除去）→ core_name
  ├─ 都道府県抽出（住所から）→ prefecture | null
  └─ 個人/法人判定
       ├─ 個人確定 → [SKIP]
       ├─ 法人確定 → Step Aへ
       └─ 判定不能（個人法人不明）→ Step Aへ（AIで最終判断）
  │
  ▼
【Step A】法人番号直接検索
  法人番号あり（13桁 + チェックディジット有効）?
  YES → WHERE corporate_number = $number
        ヒット → [CONFIRMED confidence=100] 終了
        ミス   → Step Bへ（法人番号がDBに無い = 新設法人or入力誤り）
  NO（チェックディジット不正）→ Step Bへ + reasoning に「法人番号不正」を記録
  │
  ▼
【Step B】完全一致検索
  WHERE lower(name) = lower($normalized_name) AND exclude_from_search = false
  結果0件 → Step Cへ
  結果1件 → [CONFIRMED confidence=95] 終了
  結果2件以上 →
    都道府県で絞り込み可能? → 1件に絞れたら [CONFIRMED confidence=90] 終了
    絞り込み不可 → 候補リストとして保持 → Step F（AI Case B）
  │
  ▼
【Step C】pg_trgm + 都道府県フィルター
  prefecture あり?
  YES →
    db.transaction() {
      SET LOCAL pg_trgm.similarity_threshold = 0.5
      normalized_name で検索（LIMIT 10）
      core_name で検索（LIMIT 10）
    }
    結果をマージ・スコアリング
    → 単一 + sim >= 0.85 → [CONFIRMED confidence=88] 終了
    → 複数 + sim >= 0.6  → 候補リスト保持 → Step F（AI判断）
    → 候補なし            → Step D-1へ
  NO → Step D-1へ
  │
  ▼
【Step D-1】pg_trgm（都道府県なし）normalized_name のみ
  db.transaction() {
    SET LOCAL pg_trgm.similarity_threshold = 0.7   ← 厳格必須
    normalized_name で検索（LIMIT 5）
  }
  → 単一 + sim >= 0.85 → [CONFIRMED confidence=80] 終了
  → 複数 + sim >= 0.7  → 候補リスト保持 → Step F（AI判断）
  → 候補なし            → Step D-2へ
  │
  ▼
【Step D-2】コア名称検索（ノイズ防止ガード付き）
  ガード条件: core_name.length >= 5 文字?
  NO（短すぎる）→ [AI Case C] へ直行  ← "鈴木"等のノイズ爆発を防ぐ
  YES →
    db.transaction() {
      SET LOCAL pg_trgm.similarity_threshold = 0.85  ← 極めて厳格
      core_name で検索（LIMIT 3）
    }
    → sim >= 0.85 → 候補として保持 → Step F
    → 候補なし    → [AI Case C] へ
  │
  ▼
【Step F】候補の整理とAI振り分け
  候補1件 + スコア >= 0.85 → [CONFIRMED] 終了
  候補あり（複数 or 低スコア）→ [AI Case B: 候補評価]
  候補なし → [AI Case C: 再検索]

【閉鎖法人追跡】（全Stepの確定後に実行）
  マッチした法人の close_date が非null?
  YES + successor_corporate_number あり →
    承継先法人をStep Aで検索
    → ヒット → 承継先を第1候補に、元法人を参考情報として記録
    → ミス  → 元法人のまま + reasoning に「承継先不明」を記録
```

### 3.2 会社名正規化ロジック

#### 3.2.1 文字レベル統一（処理順序厳守）

```typescript
// normalizer/company-name.ts

export function normalizeCompanyName(raw: string): string {
  if (!raw) return ''

  return raw
    // 1. 前後の空白・改行をtrim
    .trim()
    // 2. 全角英数字 → 半角（Ａ→A、１→1）
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 3. 半角カタカナ → 全角（ｱ→ア）
    .replace(/[\uFF65-\uFF9F]/g, c => HALF_TO_FULL_KANA[c] ?? c)
    // 4. 全角スペース → 半角
    .replace(/　/g, ' ')
    // 5. 連続スペースを1つに
    .replace(/\s+/g, ' ')
    // 6. 法人格表記を正規化（次のステップ）
}

// 法人格正規化テーブル
const CORPORATE_TYPE_MAP: Record<string, string> = {
  '㈱': '株式会社', '(株)': '株式会社', '（株）': '株式会社',
  '㈲': '有限会社', '(有)': '有限会社', '（有）': '有限会社',
  '(合)': '合同会社', '（合）': '合同会社',
  '(名)': '合名会社', '（名）': '合名会社',
  '(資)': '合資会社', '（資）': '合資会社',
  '㈳': '一般社団法人', '(社)': '一般社団法人',
  '㈶': '一般財団法人', '(財)': '一般財団法人',
  '社団法人': '一般社団法人',
  '財団法人': '一般財団法人',
}

// 法人格リスト（前置・後置どちらも除去するため）
const CORPORATE_SUFFIXES = [
  '株式会社', '有限会社', '合同会社', '合名会社', '合資会社',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', 'NPO法人', '医療法人', '学校法人',
  '社会福祉法人', '宗教法人', '農業協同組合', '信用金庫', '信用組合',
]

// コア名称生成: 法人格を前後から除去した名称
export function extractCoreName(normalized: string): string {
  let core = normalized
  for (const suffix of CORPORATE_SUFFIXES) {
    core = core.replace(new RegExp(`^${suffix}\\s*`), '')
    core = core.replace(new RegExp(`\\s*${suffix}$`), '')
  }
  const result = core.trim()
  // ガード: ゴミデータ等で空文字になってしまった場合は元文字列を返す
  return result === '' ? normalized : result
}
```

#### 3.2.2 都道府県抽出

```typescript
// normalizer/address.ts

const PREFECTURE_PATTERN =
  /^(東京都|北海道|(?:大阪|京都)府|[\u4E00-\u9FFF]{2,3}県)/

export function extractPrefecture(address: string | null): string | null {
  if (!address) return null
  const match = address.match(PREFECTURE_PATTERN)
  return match?.[1] ?? null
}

// "東京" → "東京都" への補完テーブル
const PREFECTURE_ALIAS: Record<string, string> = {
  '東京': '東京都', '大阪': '大阪府', '京都': '京都府', '北海道': '北海道',
}
```

#### 3.2.3 法人番号クレンジング・チェックディジット検証

```typescript
// normalizer/corporate-number.ts

/**
 * 法人番号の検証（国税庁チェックディジット方式）
 * 法人番号 = 1桁のチェックディジット + 12桁の基礎番号
 * チェックディジット = 9 - ((Σ(Pi × Qi)) mod 9)
 *   Pi: 基礎番号の各桁（右から）
 *   Qi: 偶数位置は1、奇数位置は2
 */
export function validateCorporateNumber(raw: string | null): {
  isValid: boolean
  cleaned: string | null
  reason?: string
} {
  if (!raw) return { isValid: false, cleaned: null }

  // ハイフン・スペース除去
  const cleaned = raw.replace(/[-\s　]/g, '')

  if (!/^\d{13}$/.test(cleaned)) {
    return { isValid: false, cleaned: null, reason: '13桁の数字ではない' }
  }

  // チェックディジット検証
  const check = Number(cleaned[0])
  const body = cleaned.slice(1)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const p = Number(body[11 - i])
    const q = (i % 2 === 0) ? 1 : 2
    sum += p * q
  }
  const expected = 9 - (sum % 9)
  const expectedDigit = expected === 9 ? 9 : expected

  if (check !== expectedDigit) {
    return { isValid: false, cleaned, reason: `チェックディジット不正（期待値: ${expectedDigit}）` }
  }

  return { isValid: true, cleaned }
}
```

### 3.3 個人/法人判定ロジック

```typescript
// classifier/entity-type.ts

type EntityJudgment = 'corporation' | 'individual' | 'unknown'

// 法人確定パターン（1つでも一致すれば法人）
const CORPORATION_PATTERNS = [
  /株式会社|有限会社|合同会社|合名会社|合資会社/,
  /一般社団法人|一般財団法人|公益社団法人|公益財団法人/,
  /特定非営利活動法人|NPO法人|医療法人|学校法人/,
  /社会福祉法人|宗教法人|農業協同組合|信用金庫|信用組合/,
  /㈱|㈲|㈳|㈶/,
  // 屋号パターン（法人扱い）
  /(?:商店|工務店|農園|農場|建設|製作所|工業|産業|興業|開発)$/,
  /(?:サービス|システム|フーズ|フード|ホールディングス)$/,
]

// 個人名確定パターン（1つでも一致すればスキップ）
const INDIVIDUAL_PATTERNS = [
  // 日本語氏名（姓名パターン: 漢字 スペース 漢字）
  /^[\u4E00-\u9FFF]{1,4}[\s　][\u4E00-\u9FFF]{1,4}$/,
  // 敬称付き
  /[様氏]$|さん$|くん$|先生$/,
]

export function judgeEntityType(companyName: string | null): EntityJudgment {
  if (!companyName || companyName === '不明') return 'unknown'

  for (const pattern of INDIVIDUAL_PATTERNS) {
    if (pattern.test(companyName)) return 'individual'
  }
  for (const pattern of CORPORATION_PATTERNS) {
    if (pattern.test(companyName)) return 'corporation'
  }

  return 'unknown'  // AIに判断させる
}
```

### 3.4 DB接続設定（明示的プール制限）

```typescript
// db/index.ts

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

// Cloud SQL ソケット接続の検出（既存APIと同じパターン）
const url = new URL(databaseUrl)
const isCloudSql = url.searchParams.get('host')?.startsWith('/')

const connectionOptions: postgres.Options<{}> = {
  max: 10,                    // ★ 明示的にプール上限を設定
  idle_timeout: 20,           // アイドル接続のタイムアウト（秒）
  connect_timeout: 10,        // 接続タイムアウト（秒）
  ...(isCloudSql ? {
    host: url.searchParams.get('host')!,
    database: url.pathname.slice(1),
    username: url.username,
    password: decodeURIComponent(url.password),
  } : {
    // ローカル開発: DATABASE_URL をそのまま使用
  }),
}

const client = isCloudSql
  ? postgres(connectionOptions)
  : postgres(databaseUrl, { max: 10, idle_timeout: 20, connect_timeout: 10 })

export const db = drizzle(client)
```

### 3.5 pg_trgm検索のSQL設計（SET LOCAL でセッション隔離）

#### ガード1: SET LOCAL をトランザクション内に限定 + threshold値バリデーション

```typescript
// searcher/trgm-search.ts

import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'

// 許可するthreshold値の範囲（SQLインジェクション防止）
const VALID_THRESHOLDS = [0.5, 0.7, 0.85] as const
type ValidThreshold = typeof VALID_THRESHOLDS[number]

interface TrgmSearchOptions {
  normalizedName: string
  coreName?: string
  prefecture?: string
  threshold: ValidThreshold
  limit: number
}

interface SearchCandidate {
  corporateNumber: string
  name: string
  domPrefecture: string | null
  domCity: string | null
  domAddress: string | null
  corporationType: string | null
  closeDate: string | null
  successorCorporateNumber: string | null
  similarityScore: number
  matchedField: 'normalized' | 'core'
}

export async function searchWithTrgm(
  opts: TrgmSearchOptions
): Promise<SearchCandidate[]> {
  // threshold値のホワイトリスト検証
  if (!VALID_THRESHOLDS.includes(opts.threshold)) {
    throw new Error(`Invalid threshold: ${opts.threshold}`)
  }

  const results = await db.transaction(async (tx) => {
    // SET LOCAL はトランザクション終了時に自動リセットされる
    // → コネクションプールの他の接続・既存APIへの影響ゼロ
    await tx.execute(
      sql`SET LOCAL pg_trgm.similarity_threshold = ${opts.threshold}`
    )

    const prefectureFilter = opts.prefecture
      ? sql`AND dom_prefecture = ${opts.prefecture}`
      : sql``

    // normalized_name で検索
    const normalizedResults = await tx.execute<SearchCandidate>(sql`
      SELECT
        corporate_number AS "corporateNumber",
        name,
        dom_prefecture AS "domPrefecture",
        dom_city AS "domCity",
        dom_address AS "domAddress",
        corporation_type AS "corporationType",
        close_date AS "closeDate",
        successor_corporate_number AS "successorCorporateNumber",
        similarity(name, ${opts.normalizedName}) AS "similarityScore",
        'normalized' AS "matchedField"
      FROM corporation
      WHERE
        exclude_from_search = false
        AND name % ${opts.normalizedName}
        ${prefectureFilter}
      ORDER BY "similarityScore" DESC
      LIMIT ${opts.limit}
    `)

    let coreResults: typeof normalizedResults = { rows: [] }

    // core_name 検索は normalizedName と異なる場合のみ実行
    if (opts.coreName && opts.coreName !== opts.normalizedName) {
      coreResults = await tx.execute<SearchCandidate>(sql`
        SELECT
          corporate_number AS "corporateNumber",
          name,
          dom_prefecture AS "domPrefecture",
          dom_city AS "domCity",
          dom_address AS "domAddress",
          corporation_type AS "corporationType",
          close_date AS "closeDate",
          successor_corporate_number AS "successorCorporateNumber",
          similarity(name, ${opts.coreName}) AS "similarityScore",
          'core' AS "matchedField"
        FROM corporation
        WHERE
          exclude_from_search = false
          AND name % ${opts.coreName}
          ${prefectureFilter}
        ORDER BY "similarityScore" DESC
        LIMIT ${opts.limit}
      `)
    }

    return [...normalizedResults.rows, ...coreResults.rows]
  })

  // corporate_number で重複排除（similarityScore最大値を採用）
  const deduped = new Map<string, SearchCandidate>()
  for (const row of results) {
    const existing = deduped.get(row.corporateNumber)
    if (!existing || row.similarityScore > existing.similarityScore) {
      deduped.set(row.corporateNumber, row)
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.similarityScore - a.similarityScore)
}
```

#### ガード2: Step D のノイズ防止（段階的フォールバック）

```typescript
// searcher/index.ts（Step D部分の実装方針）

async function stepD(input: NormalizedInput): Promise<CandidateList> {
  // D-1: normalized_name で都道府県なし検索
  const d1Results = await searchWithTrgm({
    normalizedName: input.normalizedName,
    // coreName は渡さない（D-1では使わない）
    threshold: 0.7,    // 都道府県なし → 厳格
    limit: 5,
  })

  if (d1Results.length > 0) {
    return d1Results  // D-1でヒットしたらD-2はスキップ
  }

  // D-2: core_name 検索（ノイズ防止ガード）
  const MIN_CORE_NAME_LENGTH = 5  // "鈴木"(2文字)などの短い名称はスキップ

  if (
    !input.coreName ||
    input.coreName.length < MIN_CORE_NAME_LENGTH ||
    input.coreName === input.normalizedName  // core_nameと同じなら意味なし
  ) {
    return []  // → AI Case Cへ
  }

  const d2Results = await searchWithTrgm({
    normalizedName: input.coreName,
    threshold: 0.85,  // core_nameは短いため極めて厳格
    limit: 3,
  })

  return d2Results
}
```

### 3.6 信頼度スコアの算出（全Step対応）

```typescript
// searcher/confidence.ts

type MatchMethod = 'direct' | 'exact' | 'trgm_pref' | 'trgm_nopref' | 'core' | 'ai_eval' | 'ai_search'

interface ScoreInput {
  matchMethod: MatchMethod
  candidate?: SearchCandidate       // trgm系のみ
  aiConfidence?: number             // AI系のみ
  inputPrefecture: string | null
  inputAddress: string | null
  totalCandidates: number
}

export function calculateConfidence(input: ScoreInput): number {
  // Step A/B: 固定スコア（similarityScoreを持たない）
  switch (input.matchMethod) {
    case 'direct':
      return 100
    case 'exact':
      return input.totalCandidates === 1 ? 95 : 90
  }

  // AI系: AIが返した信頼度をベースに
  if (input.matchMethod === 'ai_eval' || input.matchMethod === 'ai_search') {
    return Math.max(0, Math.min(100, input.aiConfidence ?? 50))
  }

  // trgm系: similarity をベースに加減点
  const { candidate } = input
  if (!candidate) return 0

  // 基礎点（0〜80）
  let score = Math.round(candidate.similarityScore * 80)

  // 加点
  if (
    input.inputPrefecture &&
    candidate.domPrefecture === input.inputPrefecture
  ) {
    score += 8  // 都道府県一致
  }
  if (
    input.inputAddress &&
    candidate.domCity &&
    input.inputAddress.includes(candidate.domCity)
  ) {
    score += 5  // 市区町村一致
  }
  if (input.totalCandidates === 1) {
    score += 4  // 候補が1件のみ（一意性）
  }

  // 減点
  if (candidate.closeDate !== null) {
    score -= 20  // 閉鎖・解散済み法人
  }
  if (input.totalCandidates >= 5) {
    score -= 8   // 候補が多すぎる（曖昧）
  }
  if (input.matchMethod === 'core') {
    score -= 5   // コア名称マッチは精度低め
  }

  return Math.max(0, Math.min(100, score))
}
```

### 3.7 アウトカム分類

| 信頼度 | アウトカム | 出力内容 |
|--------|-----------|---------|
| 法人番号直接一致 | `confirmed` | マッチした1件 |
| 90〜100% | `confirmed` | マッチした1件（自動確定） |
| 75〜89% | `confirmed` | マッチした1件（自動確定） |
| 50〜74% | `review_needed` | 上位3件 + AI根拠 |
| 1〜49% | `unmatched` | 参考として上位3件を出力 |
| 0% | `unmatched` | 空 |
| 個人名確定 | `skipped` | スキップ理由を記録 |

---

## 4. 並行処理設計（p-limitによる制御）

### 4.1 なぜ並行制御が必要か

```
直列処理（for...of）の問題:
  1,000行 × 平均処理時間
  - ローカル処理: 750行 × 10ms = 7.5秒
  - AI Case B:   150行 × 2秒  = 300秒（5分）
  - AI Case C:   100行 × 5秒  = 500秒（8分）
  合計 ≈ 14分 → ギリギリだが直列では確実に超過

Promise.all（無制限並行）の問題:
  - DB接続枯渇（コネクションプール上限超過）
  - Vertex APIレート制限（429エラー）
  → システム全体が不安定になる
```

### 4.2 並行数設計と順序保証

```typescript
// batch/processor.ts

import pLimit from 'p-limit'

// 並行数設定
const CONCURRENCY = {
  DB: 10,     // DBコネクションプール上限に合わせる
  AI_B: 5,    // Vertex AI Gemini Flash: QPM余裕を持って5並行
  AI_C: 3,    // Vertex AI function calling は重い → 控えめ
} as const

export async function processBatch(
  rows: InputRow[],
  outputCsvPath: string,
  checkpoint: CheckpointManager,
  logger: ProgressLogger,
): Promise<MatchResult[]> {
  const dbLimit = pLimit(CONCURRENCY.DB)
  const aiBLimit = pLimit(CONCURRENCY.AI_B)
  const aiCLimit = pLimit(CONCURRENCY.AI_C)

  // 結果配列を入力と同じサイズで初期化（順序保証のため）
  const results: MatchResult[] = new Array(rows.length)

  const tasks = rows.map((row, index) =>
    dbLimit(async () => {
      try {
        let result: MatchResult

        const localResult = await runLocalSearch(row)

        if (localResult.outcome === 'confirmed') {
          result = localResult
        } else if (localResult.hasCandidates) {
          // Case B: 候補リストをAIが評価
          result = await aiBLimit(() =>
            callVertexWithRetry(() => evaluateCandidatesWithAI(row, localResult.candidates))
          )
        } else {
          // Case C: 全不一致 → AI + function calling で再検索
          // ★ executeTool内のDB呼び出しもdbLimitを渡して制御する
          result = await aiCLimit(() =>
            callVertexWithRetry(() => searchWithAI(row, dbLimit))
          )
        }

        // 閉鎖法人の承継先追跡
        if (result.matchedCloseDate && result.matchedSuccessorCorporateNumber) {
          result = await dbLimit(() => traceSuccessor(result))
        }

        // 入力順序のインデックスに結果を格納
        results[index] = result
      } catch (error) {
        // ★ 1行の失敗で全体を停止させない
        results[index] = createErrorResult(row, error)
        logger.logError(row, error)
      }

      // 進捗更新
      logger.increment()
      checkpoint.markCompleted(index)
    })
  )

  await Promise.all(tasks)

  return results  // 入力順序が保証された結果配列
}
```

### 4.3 Case C内のDB呼び出し制御

```typescript
// ai/search-with-ai.ts

const MAX_TOOL_CALLS = 3

export async function searchWithAI(
  input: InputRow,
  dbLimit: pLimit.Limit,  // ★ 呼び出し元からdbLimitを受け取る
): Promise<AiSearchResult> {
  const chat = flashModelWithTools.startChat()
  let toolCallCount = 0

  // ... (初期プロンプト送信)

  while (toolCallCount < MAX_TOOL_CALLS) {
    const functionCall = response.response.candidates?.[0]
      ?.content?.parts?.find(p => p.functionCall)?.functionCall

    if (!functionCall) break

    toolCallCount++
    // ★ DB検索をdbLimitのスコープ内で実行
    const toolResult = await dbLimit(() =>
      executeTool(functionCall.name, functionCall.args)
    )

    response = await chat.sendMessage([{
      functionResponse: {
        name: functionCall.name,
        response: { results: toolResult },
      },
    }])
  }

  // 最終回答をZodでバリデーション
  const finalText = response.response.candidates?.[0]
    ?.content?.parts?.find(p => p.text)?.text ?? '{}'
  return parseAiSearchResult(finalText)
}
```

### 4.4 処理性能の見積もり（p-limit導入後）

```
1,000行処理の場合:

ローカル処理（750行、DB並行=10）:
  750行 ÷ 10並行 × 10ms = 0.75秒

AI Case B（150行、AI-B並行=5）:
  150行 ÷ 5並行 × 2秒 = 60秒（1分）

AI Case C（100行、AI-C並行=3）:
  100行 ÷ 3並行 × 5秒 ≈ 167秒（2.8分）

合計 ≈ 4〜5分（目標15分に対して十分な余裕）
```

---

## 5. AI処理の設計（Vertex AI Gemini・フォールバックのみ）

### 5.1 AIを呼び出す2つのケース

| ケース | 条件 | AIの役割 | モデル | 概算コスト |
|--------|------|---------|--------|-----------|
| Case B | 候補あり・絞れない | 候補リストを評価・選択（DB検索なし） | gemini-2.0-flash-001 | ~$0.0005/件 |
| Case C | 全くヒットしない | function callingで自由に再検索 | gemini-2.0-flash-001 | ~$0.005/件 |

両ケースとも同一モデル（gemini-2.0-flash-001）を使用。Flash は function calling にも対応しており、Proより高速・低コストで同等の精度が出る。

### 5.2 Vertex AI クライアント初期化

```typescript
// ai/client.ts

import { VertexAI, FunctionDeclarationSchemaType } from '@google-cloud/vertexai'

// 認証: ADC（Application Default Credentials）を自動使用
// ローカル: gcloud auth application-default login
// GCP上: サービスアカウント corporation-matching@jp-corporate-search.iam.gserviceaccount.com
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID ?? 'jp-corporate-search',
  location: process.env.GCP_LOCATION ?? 'asia-northeast1',
})

// Case B: 候補評価（JSONモードを活用）
export const flashModel = vertexAI.getGenerativeModel({
  model: 'gemini-2.0-flash-001',
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 512,
    responseMimeType: 'application/json',
  },
})

// Case C: function calling（ツール付き）
export const flashModelWithTools = vertexAI.getGenerativeModel({
  model: 'gemini-2.0-flash-001',
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 1024,
  },
  tools: [{
    functionDeclarations: [
      {
        name: 'search_by_name_with_prefecture',
        description: '都道府県を指定して会社名でファジー検索する',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            name: {
              type: FunctionDeclarationSchemaType.STRING,
              description: '検索する会社名（正規化済み）',
            },
            prefecture: {
              type: FunctionDeclarationSchemaType.STRING,
              description: '都道府県名（例: 東京都）',
            },
          },
          required: ['name', 'prefecture'],
        },
      },
      {
        name: 'search_by_name',
        description: '全国から会社名でファジー検索する（都道府県不明の場合のみ使用）',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            name: { type: FunctionDeclarationSchemaType.STRING },
          },
          required: ['name'],
        },
      },
    ],
  }],
})
```

### 5.3 Case B: 候補評価プロンプト

```typescript
// ai/evaluate-candidates.ts

const systemInstruction = `
あなたは日本の法人名寄せの専門家です。
提示された候補の中から、入力情報と最もよく一致する法人を選んでください。

ルール:
- 閉鎖済み法人（close_date あり）は基本的に選ばない
- 同名でも住所が全く異なる場合は選ばない
- 判断できない場合は selected_index に null を返す
`

const userPrompt = (input: InputRow, candidates: SearchCandidate[]) => `
【入力情報】
会社名: ${input.company_name ?? '不明'}
所在地: ${input.address ?? '不明'}

【検索で見つかった候補】
${candidates.map((c, i) => `
${i + 1}. 法人番号: ${c.corporateNumber}
   正式名称: ${c.name}
   住所: ${c.domPrefecture ?? ''}${c.domCity ?? ''}${c.domAddress ?? ''}
   閉鎖: ${c.closeDate ? `あり（${c.closeDate}）` : 'なし'}
   類似度: ${Math.round(c.similarityScore * 100)}%
`).join('')}

以下のJSONスキーマで回答してください:
{
  "selected_index": number | null,
  "confidence": number,
  "reasoning": string
}
`

export async function evaluateCandidates(
  input: InputRow,
  candidates: SearchCandidate[]
): Promise<AiEvalResult> {
  const result = await flashModel.generateContent({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: userPrompt(input, candidates) }] }],
  })

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  return AiEvalResultSchema.parse(JSON.parse(text))  // ★ Zodでバリデーション
}

// Zodスキーマ
const AiEvalResultSchema = z.object({
  selected_index: z.number().int().min(1).nullable(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
})
```

### 5.4 Case C: function calling（Gemini のマルチターン）

```typescript
// ai/search-with-ai.ts

const MAX_TOOL_CALLS = 3  // コスト制御: 最大3回

const AiSearchResultSchema = z.object({
  judgment: z.enum(['matched', 'individual', 'unmatched']),
  corporate_number: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
})

function parseAiSearchResult(text: string): AiSearchResult {
  try {
    return AiSearchResultSchema.parse(JSON.parse(text))
  } catch {
    // JSONパース失敗 or スキーマ不一致 → unmatched扱い
    return {
      judgment: 'unmatched',
      corporate_number: null,
      confidence: 0,
      reasoning: `AI応答のパースに失敗: ${text.slice(0, 100)}`,
    }
  }
}
```

### 5.5 レート制限・リトライ（Vertex AI版）

```typescript
// ai/client.ts

export async function callVertexWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      // Vertex AI のレート制限: HTTP 429 または RESOURCE_EXHAUSTED
      if (isQuotaError(error) && attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 60_000)
        await sleep(waitMs)
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')
}
```

---

## 6. エラーハンドリング・ログ設計

### 6.1 エラーハンドリング方針

| エラー種別 | 挙動 | 出力 |
|-----------|------|------|
| 1行のDB検索タイムアウト | その行をスキップ、次の行へ | outcome=`error`, reasoning にエラー内容 |
| AI応答のJSON不正 | unmatched扱いで続行 | reasoning に「AI応答パース失敗」 |
| AI応答のスキーマ不正（Zod） | unmatched扱いで続行 | reasoning にZodエラー詳細 |
| DB接続プール枯渇 | p-limitが待機させるため発生しない | — |
| Vertex AI 429/RESOURCE_EXHAUSTED | Exponential Backoff（最大4回） | 4回超過で該当行をエラー |
| CSV読み込みエンコーディング不明 | 処理全体を停止 | エラーメッセージで文字コードを提示 |
| チェックディジット不正 | Step Bへフォールバック | reasoning に「法人番号チェックディジット不正」 |

### 6.2 進捗ログ・処理統計

```typescript
// batch/logger.ts

export class ProgressLogger {
  private completed = 0
  private errors = 0
  private startTime = Date.now()
  private outcomes = { confirmed: 0, review_needed: 0, unmatched: 0, skipped: 0, error: 0 }

  constructor(private total: number) {}

  increment(outcome?: Outcome) {
    this.completed++
    if (outcome) this.outcomes[outcome]++

    // 10%刻み or 100行毎に進捗表示
    if (this.completed % Math.max(1, Math.floor(this.total / 10)) === 0) {
      const pct = Math.round((this.completed / this.total) * 100)
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
      console.log(`[${pct}%] ${this.completed}/${this.total} 処理済み (${elapsed}秒経過)`)
    }
  }

  logError(row: InputRow, error: unknown) {
    this.errors++
    console.error(`[ERROR] 行${row.input_id ?? '?'}: ${error instanceof Error ? error.message : String(error)}`)
  }

  printSummary() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
    console.log(`\n=== 処理完了 ===`)
    console.log(`総件数: ${this.total}`)
    console.log(`  自動確定: ${this.outcomes.confirmed}`)
    console.log(`  要確認:   ${this.outcomes.review_needed}`)
    console.log(`  不一致:   ${this.outcomes.unmatched}`)
    console.log(`  スキップ: ${this.outcomes.skipped}`)
    console.log(`  エラー:   ${this.outcomes.error}`)
    console.log(`処理時間: ${elapsed}秒`)
    console.log(`自動確定率: ${Math.round((this.outcomes.confirmed / this.total) * 100)}%`)
  }
}
```

### 6.3 チェックポイント設計

```typescript
// batch/checkpoint.ts

interface CheckpointData {
  inputFile: string           // 入力CSVファイルのパス
  inputHash: string           // 入力CSVのSHA-256（変更検知）
  totalRows: number
  completedIndices: number[]  // 完了した行インデックス
  lastUpdated: string         // ISO 8601
}

// チェックポイントファイル: {outputDir}/.matching-checkpoint.json
// 50行完了ごとにファイルに書き出す

export class CheckpointManager {
  private data: CheckpointData
  private dirtyCount = 0
  private readonly FLUSH_INTERVAL = 50

  markCompleted(index: number) {
    this.data.completedIndices.push(index)
    this.dirtyCount++
    if (this.dirtyCount >= this.FLUSH_INTERVAL) {
      this.flush()
    }
  }

  getSkipSet(): Set<number> {
    return new Set(this.data.completedIndices)
  }

  // --resume 時: 入力ファイルのハッシュが一致するか検証
  // 不一致なら警告して最初からやり直し
}
```

---

## 7. ハイブリッド処理の期待効率

```
全入力 1,000行の想定内訳:

【ローカル処理で完結（AI呼び出しなし）】
  Step A: 法人番号直接確定     約10%  (100行)
  Step B: 完全一致確定         約15%  (150行)
  Step C: pg_trgm高スコア確定  約40%  (400行)
  スキップ（個人名）           約 5%  ( 50行)
  ────────────────────────────────────
  ローカル完結計               約70%  (700行)

【Vertex AI Gemini が必要】
  Case B: 候補リスト評価       約20%  (200行) Flash使用
  Case C: 再検索付き           約10%  (100行) Flash + function calling
  ────────────────────────────────────
  AI処理計                     約30%  (300行)

Vertex AI Gemini 2.0 Flash コスト概算（東京リージョン）:
  Case B: 200行 × $0.0005/行 ≈ $0.10
  Case C: 100行 × $0.005/行  ≈ $0.50
  合計                        ≈ $0.60 / 1,000行  ← GCPプロジェクトに請求

  比較:
  v1旧設計（全件Claude Sonnet）: ≈ $30〜50 / 1,000行
  v3（Claude Haiku/Sonnet）    : ≈  $2.20 / 1,000行
  v4（Vertex AI Gemini Flash） : ≈  $0.60 / 1,000行  → さらに73%削減
```

---

## 8. 出力フォーマット詳細

### 8.1 CSVカラム定義

| # | カラム名 | 説明 |
|---|----------|------|
| 1 | input_id | 入力IDそのまま |
| 2 | input_corporate_number | 入力法人番号そのまま |
| 3 | input_company_name | 入力会社名そのまま |
| 4 | input_address | 入力所在地そのまま |
| 5 | input_phone | 入力電話番号そのまま |
| 6 | outcome | confirmed / review_needed / unmatched / skipped / error |
| 7 | confidence | 信頼度（0〜100の整数）|
| 8 | matched_corporate_number | マッチした法人番号 |
| 9 | matched_name | マッチした正式法人名 |
| 10 | matched_prefecture | 都道府県 |
| 11 | matched_city | 市区町村 |
| 12 | matched_address | 丁目番地等 |
| 13 | matched_corporation_type | 法人種別コード |
| 14 | is_closed | 閉鎖法人フラグ（true/false）|
| 15 | successor_corporate_number | 承継先法人番号（閉鎖時）|
| 16 | candidate_2_corporate_number | 候補2（review_needed時）|
| 17 | candidate_2_name | 候補2の法人名 |
| 18 | candidate_2_confidence | 候補2の信頼度 |
| 19 | candidate_3_corporate_number | 候補3 |
| 20 | candidate_3_name | 候補3の法人名 |
| 21 | candidate_3_confidence | 候補3の信頼度 |
| 22 | match_method | direct / exact / trgm_pref / trgm_nopref / core / ai_eval / ai_search |
| 23 | reasoning | 判断理由（AIまたはローカルルール） |
| 24 | processed_at | 処理日時（ISO 8601）|

### 8.2 Excel固有仕様

- **シート構成**: 「サマリー」「全件」「自動確定」「要確認」「マッチ不能・スキップ」
- **行カラーコード**:
  - confirmed: 薄緑（#E8F5E9）
  - review_needed: 薄黄（#FFF9C4）
  - unmatched: 薄赤（#FFEBEE）
  - skipped: 薄灰（#F5F5F5）
  - error: 薄オレンジ（#FFF3E0）
- **サマリーシート**: 総件数・各outcome件数・自動確定率・処理時間・APIコスト概算・エラー件数

---

## 9. WBS

### Phase 0: 前提条件確認（0.5日）

| ID | タスク |
|----|--------|
| P0-01 | pg_trgm拡張の有効化確認（CREATE EXTENSIONが必要か） |
| P0-02 | similarity()関数の動作確認（既存DBで実行テスト） |
| P0-03 | DB max_connectionsの確認と名寄せ用10本の確保可否判断 |
| P0-04 | `terraform apply` でVertex AI API有効化・SAを作成 |

### Phase 1: 環境構築（1〜2日）

| ID | タスク |
|----|--------|
| P1-01 | matching/ ディレクトリ初期化（package.json, tsconfig） |
| P1-02 | 依存関係インストール（drizzle-orm, @google-cloud/vertexai, exceljs, csv-parse, iconv-lite, p-limit, zod） |
| P1-03 | DB接続コード（max:10明示・Cloud SQLソケット対応） |
| P1-04 | セキュリティ確認事項の合意取得 |

### Phase 2: 正規化・判定ロジック実装（2〜3日）

| ID | タスク |
|----|--------|
| P2-01 | 会社名正規化（法人格テーブル・コア名称生成）**テスト先行** |
| P2-02 | 住所正規化・都道府県抽出 |
| P2-03 | 法人番号クレンジング・チェックディジット検証 |
| P2-04 | 個人/法人判定ロジック |
| P2-05 | 単体テスト（各種パターン網羅）|

### Phase 3: 検索ロジック実装（3〜4日）

| ID | タスク |
|----|--------|
| P3-01 | Step A: 法人番号直接検索 |
| P3-02 | Step B: 完全一致検索（複数一致時の都道府県絞り込み含む） |
| P3-03 | Step C: pg_trgm + 都道府県（SET LOCALトランザクション・threshold値ホワイトリスト） |
| P3-04 | Step D-1: pg_trgm 都道府県なし（threshold=0.7） |
| P3-05 | Step D-2: コア名称（5文字未満ガード・threshold=0.85） |
| P3-06 | 信頼度スコア算出（全Step対応） |
| P3-07 | 閉鎖法人の承継先追跡ロジック |
| P3-08 | 検索オーケストレーター統合 |
| P3-09 | 実データでthreshold・LIMIT値チューニング |

### Phase 4: AI統合（2〜3日）

| ID | タスク |
|----|--------|
| P4-01 | Vertex AIクライアント初期化・ADC接続確認（`gcloud auth application-default login`）|
| P4-02 | Case B: 候補評価（Gemini JSON mode・Zodバリデーション）|
| P4-03 | Case C: function calling（Gemini マルチターンチャット・dbLimit統合） |
| P4-04 | AI応答パース失敗時のフォールバック |
| P4-05 | Exponential Backoff・RESOURCE_EXHAUSTED エラー処理 |
| P4-06 | Gemini Flash の精度・コスト実測検証 |

### Phase 5: バッチ・入出力実装（2〜3日）

| ID | タスク |
|----|--------|
| P5-01 | p-limitによる並行処理制御（DB=10, AI-B=5, AI-C=3） |
| P5-02 | 結果配列による入力順序保証 |
| P5-03 | エラー行スキップ・エラーログ |
| P5-04 | CSVリーダー（Shift-JIS自動判定） |
| P5-05 | チェックポイント機能（50行毎・JSONファイル・ハッシュ検証） |
| P5-06 | CSV出力 |
| P5-07 | Excel出力（5シート・色分け・エラーシート追加） |
| P5-08 | 進捗ログ・処理統計レポート |
| P5-09 | CLIインターフェース（--input, --output, --format, --resume, --no-ai, --dry-run, --template, --verbose）|

### Phase 6: テスト・チューニング（2〜3日）

| ID | タスク |
|----|--------|
| P6-01 | サンプルデータ作成（法人番号あり・なし・個人・屋号・短いコア名称・チェックディジット不正・閉鎖法人） |
| P6-02 | E2Eテスト（サンプルCSV→全処理→出力検証） |
| P6-03 | 実データでの精度計測・閾値調整 |
| P6-04 | パフォーマンス計測（100行・1,000行・DB負荷確認） |
| P6-05 | 既存API影響テスト（名寄せ実行中のAPI応答時間を計測） |

**合計見積もり: 13〜19人日**

---

## 10. 技術スタック

| 技術 | バージョン | 用途 | 選定理由 |
|------|-----------|------|---------|
| Node.js | 20 LTS | ランタイム | 既存プロジェクト統一 |
| TypeScript | 5 | 言語 | 既存プロジェクト統一 |
| Drizzle ORM | ^0.33.0 | DBアクセス | 既存と同一バージョン |
| postgres（pg） | ^3.4.3 | DBドライバ | 既存と同一バージョン |
| @google-cloud/vertexai | latest | Vertex AI SDK | 公式SDK・ADC認証・GCP統合 |
| gemini-2.0-flash-001 | — | AI Case B/C | function calling対応・高速・GCPに課金 |
| p-limit | ^6 | 並行数制御 | シンプルで実績のあるライブラリ |
| csv-parse | ^6.1.0 | CSV読み込み | 既存と同一バージョン |
| iconv-lite | ^0.7.0 | Shift-JIS対応 | 既存と同一バージョン |
| ExcelJS | ^4 | Excel出力 | 複数シート・色付け対応 |
| Zod | ^3 | バリデーション | AI出力のスキーマ検証 |

### 環境変数（.env.example）

```bash
# DB接続（Cloud SQL）
DATABASE_URL=postgresql://app_user:password@localhost/corporations_db?host=/cloudsql/...

# GCP設定（Vertex AI）
GCP_PROJECT_ID=jp-corporate-search
GCP_LOCATION=asia-northeast1

# 認証（ローカル: gcloud auth application-default login で不要）
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json  # CI等で使う場合のみ
```

---

## 11. Terraform管理リソース一覧（既にmain.tfに追加済み）

```hcl
# API有効化（追加済み）
"aiplatform.googleapis.com"

# 名寄せシステム用サービスアカウント
resource "google_service_account" "matching" {
  account_id   = "corporation-matching"
  display_name = "Corporation Matching SA - Vertex AI + Cloud SQL"
}

# Vertex AI 呼び出し権限
resource "google_project_iam_member" "matching_vertex_ai" {
  role   = "roles/aiplatform.user"
  member = "serviceAccount:${google_service_account.matching.email}"
}

# Cloud SQL 読み取り権限
resource "google_project_iam_member" "matching_sql_client" {
  role   = "roles/cloudsql.client"
  member = "serviceAccount:${google_service_account.matching.email}"
}

# outputs.tf に追加済み
output "matching_service_account_email" { ... }
output "vertex_ai_location" { ... }
```

`terraform apply` 後に以下で SA メールアドレスを確認できる：
```bash
cd terraform
terraform output matching_service_account_email
```

---

## 12. リスクと対策（v5最終版）

| # | リスク | 深刻度 | 対策 |
|---|--------|--------|------|
| R-01 | SET がコネクションプールを汚染 | クリティカル | `db.transaction()` + `SET LOCAL` で隔離（実装必須） |
| R-02 | core_name短文字でノイズ爆発 | クリティカル | core_name < 5文字はStep D-2スキップ・AI Case Cへ |
| R-03 | pg_trgm拡張が未有効 | クリティカル | Phase 0で確認・必要なら `CREATE EXTENSION pg_trgm;` |
| R-04 | Case CのDB呼び出しがdbLimit外 | 高 | searchWithAIにdbLimitを引数で渡して制御 |
| R-05 | DB接続が既存APIを圧迫 | 高 | max=10明示 + Phase 6でAPI応答時間を計測 |
| R-06 | 直列処理で処理時間超過 | 高 | p-limitでDB=10, AI-B=5, AI-C=3 の並行制御 |
| R-07 | Vertex AI RESOURCE_EXHAUSTED エラー | 高 | Exponential Backoff（最大4回・上限60秒）|
| R-08 | pg_trgm都道府県なしの高負荷 | 高 | threshold=0.7・LIMIT=5 を厳守 |
| R-09 | AI応答がJSON不正 / スキーマ不一致 | 中 | Zodバリデーション + フォールバック（unmatched扱い） |
| R-10 | 閉鎖法人へのマッチング | 中 | confidence -20点 + 承継先自動追跡 + reasoning明記 |
| R-11 | 処理中断後の再開 | 中 | チェックポイント（50行毎）+ --resumeオプション + ハッシュ検証 |
| R-12 | 個人情報のAPI送信 | 中 | 実行前確認ゲート + --no-aiオプション |
| R-13 | CSV出力順序が入力と不一致 | 中 | 結果配列にインデックスで格納、出力時にそのまま書き出し |
| R-14 | Step B完全一致で複数法人がヒット | 低 | 都道府県絞り込み → 絞れなければAI Case Bへ |
| R-15 | SET LOCALのパラメータバインド問題 | 低 | threshold値をホワイトリストで制限 |

---

## 13. 実装推奨順序

1. **Phase 0（前提条件確認）を最初に実行**。pg_trgm拡張の有効化・DB接続数の確認を怠ると、Phase 3以降で手戻りが発生する。

2. **Phase 2（正規化）から実装開始**。会社名正規化の精度がシステム全体の精度を決める。テストを先に書くこと。

3. **Step A〜Cを動かして精度を先に計測する**。pg_trgmのthreshold値は実際の国税庁データで計測してから決定する。仮の値（0.5, 0.7）は調整前提。

4. **AI統合はStep A〜D完成後に追加**。ローカル処理だけでどこまで精度が出るかを先に把握する。

5. **並行処理は最後に追加**。まず直列で動かしてから p-limit を入れる。並行化前後で結果が変わらないことを確認すること。

6. **SET LOCALはDay1からトランザクション内で書く**。後から修正するとテスト済みコードへの影響が大きい。

7. **既存API影響テストは必ず実施**。名寄せバッチ実行中にAPIのレスポンスタイムが劣化しないことを確認する。

---

## 14. 参照すべき既存コード

| ファイル | 参照目的 |
|----------|----------|
| `src/db/schema.ts` | インデックス定義の確認（dom_prefectureにインデックスなし）・全カラム名 |
| `src/db/index.ts` | Cloud SQLソケット接続パターン（プール設定なし → matching側で明示的に設定） |
| `src/routes/companies.ts` | tokenizeQuery関数（LIKEベース検索の参考・trgmは未使用） |
| `src/utils/csv.ts` | CSVカラムマッピング・parseCsvRecord・upsertCorporation |
| `package.json` | 依存ライブラリのバージョン（drizzle-orm ^0.33.0, postgres ^3.4.3 等） |
| `terraform/main.tf` | Cloud SQLインスタンス名・SA定義・API有効化（Vertex AI追加済み） |
| `terraform/outputs.tf` | matching_service_account_email, vertex_ai_location |
