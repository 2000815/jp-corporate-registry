import "dotenv/config";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { db, schema } from "../src/db/index.js";
import { eq } from "drizzle-orm";

const { corporation } = schema;

/**
 * 国税庁法人番号データCSVのカラムインデックス定義
 * CSVはヘッダーなし、カンマ区切り、Shift_JISエンコーディング
 */
const CSV_COLUMNS = {
  sequenceNumber: 0, // 一連番号
  corporateNumber: 1, // 法人番号
  processType: 2, // 処理区分
  correctionType: 3, // 訂正区分
  updatedDate: 4, // 更新年月日
  changedDate: 5, // 変更年月日
  name: 6, // 商号又は名称
  nameImageId: 7, // 商号又は名称イメージID
  corporationType: 8, // 法人種別
  prefectureName: 9, // 国内所在地（都道府県）
  cityName: 10, // 国内所在地（市区町村）
  streetNumber: 11, // 国内所在地（丁目番地等）
  addressImageId: 12, // 国内所在地イメージID
  prefectureCode: 13, // 都道府県コード
  cityCode: 14, // 市区町村コード
  postalCode: 15, // 郵便番号
  foreignAddress: 16, // 国外所在地
  foreignAddressImageId: 17, // 国外所在地イメージID
  closeDate: 18, // 登記記録の閉鎖等年月日
  closeCause: 19, // 登記記録の閉鎖等の事由
  successorCorporateNumber: 20, // 承継先法人番号
  successorCause: 21, // 承継等事由
  successorDate: 22, // 承継等年月日
  dummyFlag: 23, // ダミーフラグ（0/1）
  nameEn: 24, // 商号又は名称（英語）
  prefectureNameEn: 25, // 国内所在地（都道府県・英語）
  streetNumberEn: 26, // 国内所在地（丁目番地等・英語）
  addressEnImageId: 27, // 国内所在地（英語）イメージID
  furigana: 28, // 商号又は名称（フリガナ）
  excludeFromSearch: 29, // 検索対象除外フラグ（0/1）
} as const;

// 設定
const CSV_FILE_PATH =
  process.env.CSV_FILE_PATH || "./data/00_zenkoku_all_20260130.csv";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "1000", 10);

// 日付を YYYY-MM-DD 形式にフォーマット
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// 時間をフォーマットするヘルパー関数
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return [h > 0 ? `${h}時間` : "", m > 0 ? `${m}分` : "", `${s}秒`]
    .filter(Boolean)
    .join(" ");
}

// 進捗表示用のユーティリティ関数
class ProgressLogger {
  private startTime: number;
  private processedCount = 0;
  private lastLogTime = 0;
  private readonly logInterval = 5000; // 5秒ごとに進捗を表示

  constructor(private readonly totalItems: number) {
    this.startTime = Date.now();
  }

  update(processed: number) {
    this.processedCount += processed;
    const now = Date.now();

    if (
      now - this.lastLogTime > this.logInterval ||
      this.processedCount === this.totalItems
    ) {
      const elapsed = (now - this.startTime) / 1000; // 秒
      const itemsPerSecond = this.processedCount / elapsed;
      const remainingItems = this.totalItems - this.processedCount;
      const remainingTime =
        itemsPerSecond > 0 ? remainingItems / itemsPerSecond : 0;

      const progress = ((this.processedCount / this.totalItems) * 100).toFixed(
        2,
      );

      process.stdout.write(
        `\r📊 進捗: ${this.processedCount.toLocaleString()}/${this.totalItems.toLocaleString()} ` +
          `(${progress}%) | 処理速度: ${Math.round(itemsPerSecond)} 件/秒 | ` +
          `残り時間: ${formatTime(remainingTime)}`,
      );

      this.lastLogTime = now;
    }
  }
}

/**
 * CSVレコードをcorporationテーブルの型に変換
 */
function parseCsvRecord(
  record: string[],
): typeof schema.corporation.$inferInsert {
  const getValue = (index: number) => {
    const val = record[index];
    return val === "" || val === undefined || val === null ? null : val;
  };

  const getDate = (index: number): string | null => {
    const val = getValue(index);
    if (!val) return null;
    // CSVは YYYY-MM-DD 形式なのでそのまま返す
    if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return val;
    }
    // YYYYMMDD形式の場合は変換
    if (val.length === 8 && /^\d{8}$/.test(val)) {
      return `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(
        6,
        8,
      )}`;
    }
    return val;
  };

  const getInt = (index: number): number | null => {
    const val = getValue(index);
    if (!val) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  };

  const getBool = (index: number): boolean => {
    const val = getValue(index);
    return val === "1" || val === "true";
  };

  return {
    id: getInt(CSV_COLUMNS.sequenceNumber) ?? 0,
    corporateNumber: getValue(CSV_COLUMNS.corporateNumber) ?? "",
    processType: getValue(CSV_COLUMNS.processType) ?? "",
    correctionType: getValue(CSV_COLUMNS.correctionType) ?? "0",
    updatedDate: getDate(CSV_COLUMNS.updatedDate) ?? formatDate(new Date()),
    changedDate: getDate(CSV_COLUMNS.changedDate),
    name: getValue(CSV_COLUMNS.name),
    nameImageId: getValue(CSV_COLUMNS.nameImageId),
    corporationType: getValue(CSV_COLUMNS.corporationType),
    prefectureName: getValue(CSV_COLUMNS.prefectureName),
    cityName: getValue(CSV_COLUMNS.cityName),
    streetNumber: getValue(CSV_COLUMNS.streetNumber),
    addressImageId: getValue(CSV_COLUMNS.addressImageId),
    prefectureCode: getValue(CSV_COLUMNS.prefectureCode),
    cityCode: getValue(CSV_COLUMNS.cityCode),
    postalCode: getValue(CSV_COLUMNS.postalCode),
    foreignAddress: getValue(CSV_COLUMNS.foreignAddress),
    foreignAddressImageId: getValue(CSV_COLUMNS.foreignAddressImageId),
    closeDate: getDate(CSV_COLUMNS.closeDate),
    closeCause: getValue(CSV_COLUMNS.closeCause),
    successorCorporateNumber: getValue(CSV_COLUMNS.successorCorporateNumber),
    successorCause: getValue(CSV_COLUMNS.successorCause),
    successorDate: getDate(CSV_COLUMNS.successorDate),
    dummyFlag: getBool(CSV_COLUMNS.dummyFlag),
    nameEn: getValue(CSV_COLUMNS.nameEn),
    prefectureNameEn: getValue(CSV_COLUMNS.prefectureNameEn),
    streetNumberEn: getValue(CSV_COLUMNS.streetNumberEn),
    addressEnImageId: getValue(CSV_COLUMNS.addressEnImageId),
    furigana: getValue(CSV_COLUMNS.furigana),
    excludeFromSearch: getBool(CSV_COLUMNS.excludeFromSearch),
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

/**
 * 単一レコードのUPSERT実行
 * corporate_number のみで判定
 */
async function upsertCorporation(
  record: typeof schema.corporation.$inferInsert,
): Promise<"inserted" | "updated"> {
  // 既存レコードを検索
  const existing = await db
    .select({ corporateNumber: corporation.corporateNumber })
    .from(corporation)
    .where(eq(corporation.corporateNumber, record.corporateNumber))
    .limit(1);

  if (existing.length === 0) {
    // INSERT
    await db.insert(corporation).values(record);
    return "inserted";
  } else {
    // UPDATE - createdAtは更新しない
    const { createdAt, ...updateData } = record;
    await db
      .update(corporation)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(corporation.corporateNumber, record.corporateNumber));
    return "updated";
  }
}

/**
 * データベースにバッチUPSERTを行う
 */
async function upsertBatch(batch: (typeof schema.corporation.$inferInsert)[]) {
  if (batch.length === 0) return { inserted: 0, updated: 0 };

  let inserted = 0;
  let updated = 0;

  for (const record of batch) {
    try {
      const result = await upsertCorporation(record);
      if (result === "inserted") inserted++;
      else updated++;
    } catch (error: any) {
      console.error(
        `\n❌ レcord処理エラー (${record.corporateNumber}):`,
        error.message,
      );
    }
  }

  return { inserted, updated };
}

/**
 * データインポートのメイン処理
 */
async function importData() {
  try {
    console.log("📥 データインポートを開始します...\n");

    // CSVファイルの存在確認
    const csvPath = resolve(CSV_FILE_PATH);
    if (!existsSync(csvPath)) {
      console.error(`❌ CSVファイルが見つかりません: ${csvPath}`);
      console.error("\n以下の手順を確認してください:");
      console.error("1. 国税庁の法人番号公表サイトからデータをダウンロード");
      console.error("2. ファイルを data/ ディレクトリに保存");
      console.error("3. または CSV_FILE_PATH 環境変数でファイルパスを指定");
      process.exit(1);
    }

    console.log(`📂 ファイルを処理中: ${csvPath}`);
    console.log("🔄 CSVをストリーム処理で読み込み中...");

    // 総行数をカウント（進捗表示用）
    const totalLines = await new Promise<number>((resolve, reject) => {
      let count = 0;
      createReadStream(csvPath)
        .pipe(iconv.decodeStream("utf-8"))
        .on("data", (chunk: Buffer) => {
          count += (chunk.toString().match(/\n/g) || []).length;
        })
        .on("end", () => resolve(count))
        .on("error", reject);
    });

    console.log(`   ✓ 総レコード数: ${totalLines.toLocaleString()}件`);
    const progressLogger = new ProgressLogger(totalLines);

    // CSVパーサーの設定
    const parser = createReadStream(csvPath)
      .pipe(iconv.decodeStream("utf-8"))
      .pipe(
        parse({
          delimiter: ",",
          quote: '"',
          relax_quotes: true,
          skip_empty_lines: true,
          from_line: 1, // ヘッダーなし
        }),
      );

    let batch: (typeof schema.corporation.$inferInsert)[] = [];
    let insertedCount = 0;
    let updatedCount = 0;
    let lineCount = 0;
    let errorCount = 0;

    console.log("\n💾 データベースにインポート中...");
    const startTime = Date.now();

    for await (const record of parser) {
      lineCount++;

      try {
        if (Array.isArray(record) && record.length >= 30) {
          const parsed = parseCsvRecord(record);
          if (parsed.corporateNumber && parsed.corporateNumber.length === 13) {
            batch.push(parsed);
          }
        }
      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.warn(`⚠️ 行${lineCount}のパースエラー:`, error);
        }
      }

      // バッチサイズに達したらDBにUPSERT
      if (batch.length >= BATCH_SIZE) {
        const result = await upsertBatch(batch);
        insertedCount += result.inserted;
        updatedCount += result.updated;
        batch = [];
        progressLogger.update(BATCH_SIZE);
      }
    }

    // 残りのレコードを処理
    if (batch.length > 0) {
      const result = await upsertBatch(batch);
      insertedCount += result.inserted;
      updatedCount += result.updated;
      progressLogger.update(batch.length);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n\n✅ インポート完了！`);
    console.log(`   - 処理時間: ${formatTime(elapsed)}`);
    console.log(`   - 総レコード数: ${lineCount.toLocaleString()}件`);
    console.log(`   - 新規挿入: ${insertedCount.toLocaleString()}件`);
    console.log(`   - 更新: ${updatedCount.toLocaleString()}件`);
    console.log(`   - スキップ/エラー: ${errorCount.toLocaleString()}件`);
    console.log(
      `   - 平均速度: ${Math.round(
        (insertedCount + updatedCount) / elapsed,
      )} 件/秒`,
    );
  } catch (error) {
    console.error("\n❌ エラー:", error);
    process.exit(1);
  }
}

// スクリプト実行
importData();
