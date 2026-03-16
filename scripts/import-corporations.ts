import "dotenv/config";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { db, schema } from "../src/db/index.js";
import { eq, sql } from "drizzle-orm";

const { corporation } = schema;

/**
 * 国税庁法人番号データCSVのカラムインデックス定義
 * CSVはヘッダーなし、カンマ区切り
 */
const CSV_COLUMNS = {
  sequenceNumber: 0,        // 一連番号
  corporateNumber: 1,       // 法人番号
  processType: 2,           // 処理区分
  correctionType: 3,        // 訂正区分
  updatedDate: 4,           // 更新年月日
  changedDate: 5,           // 変更年月日
  name: 6,                  // 商号又は名称
  nameImageId: 7,           // 商号又は名称イメージID
  corporationType: 8,       // 法人種別
  domPrefecture: 9,         // 国内所在地（都道府県）
  domCity: 10,              // 国内所在地（市区町村）
  domAddress: 11,           // 国内所在地（丁目番地等）
  domAddressImageId: 12,    // 国内所在地イメージID
  prefectureCode: 13,       // 都道府県コード
  cityCode: 14,             // 市区町村コード
  postalCode: 15,           // 郵便番号
  foreignAddress: 16,       // 国外所在地
  foreignAddressImageId: 17,// 国外所在地イメージID
  closeDate: 18,            // 登記記録の閉鎖等年月日
  closeCause: 19,           // 登記記録の閉鎖等の事由
  successorCorporateNumber: 20, // 承継先法人番号
  successorCause: 21,       // 承継等事由
  successorDate: 22,        // 承継等年月日
  dummyFlag: 23,            // ダミーフラグ（0/1）
  nameEn: 24,               // 商号又は名称（英語）
  domPrefectureEn: 25,      // 国内所在地（都道府県・英語）
  domAddressEn: 26,         // 国内所在地（丁目番地等・英語）
  domAddressEnImageId: 27,  // 国内所在地（英語）イメージID
  furigana: 28,             // 商号又は名称（フリガナ）
  excludeFromSearch: 29,    // 検索対象除外フラグ（0/1）
} as const;

const CSV_FILE_PATH =
  process.env.CSV_FILE_PATH || "./data/00_zenkoku_all_20260130.csv";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "1000", 10);

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h > 0 ? `${h}時間` : "", m > 0 ? `${m}分` : "", `${s}秒`]
    .filter(Boolean)
    .join(" ");
}

class ProgressLogger {
  private startTime: number;
  private processedCount = 0;
  private lastLogTime = 0;
  private readonly logInterval = 5000;

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
      const elapsed = (now - this.startTime) / 1000;
      const itemsPerSecond = this.processedCount / elapsed;
      const remainingItems = this.totalItems - this.processedCount;
      const remainingTime =
        itemsPerSecond > 0 ? remainingItems / itemsPerSecond : 0;
      const progress = ((this.processedCount / this.totalItems) * 100).toFixed(2);

      process.stdout.write(
        `\r進捗: ${this.processedCount.toLocaleString()}/${this.totalItems.toLocaleString()} ` +
          `(${progress}%) | 処理速度: ${Math.round(itemsPerSecond)} 件/秒 | ` +
          `残り時間: ${formatTime(remainingTime)}`,
      );

      this.lastLogTime = now;
    }
  }
}

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
    if (val.match(/^\d{4}-\d{2}-\d{2}$/)) return val;
    if (val.length === 8 && /^\d{8}$/.test(val)) {
      return `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
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
    name: getValue(CSV_COLUMNS.name)?.substring(0, 300),
    nameImageId: getValue(CSV_COLUMNS.nameImageId)?.substring(0, 8),
    corporationType: getValue(CSV_COLUMNS.corporationType)?.substring(0, 3),
    domPrefecture: getValue(CSV_COLUMNS.domPrefecture)?.substring(0, 50),
    domCity: getValue(CSV_COLUMNS.domCity)?.substring(0, 100),
    domAddress: getValue(CSV_COLUMNS.domAddress)?.substring(0, 300),
    domAddressImageId: getValue(CSV_COLUMNS.domAddressImageId)?.substring(0, 8),
    prefectureCode: getValue(CSV_COLUMNS.prefectureCode)?.substring(0, 2),
    cityCode: getValue(CSV_COLUMNS.cityCode)?.substring(0, 5),
    postalCode: getValue(CSV_COLUMNS.postalCode)?.substring(0, 7),
    foreignAddress: getValue(CSV_COLUMNS.foreignAddress)?.substring(0, 300),
    foreignAddressImageId: getValue(CSV_COLUMNS.foreignAddressImageId)?.substring(0, 8),
    closeDate: getDate(CSV_COLUMNS.closeDate),
    closeCause: getValue(CSV_COLUMNS.closeCause)?.substring(0, 2),
    successorCorporateNumber: getValue(CSV_COLUMNS.successorCorporateNumber)?.substring(0, 13),
    successorCause: getValue(CSV_COLUMNS.successorCause)?.substring(0, 200),
    successorDate: getDate(CSV_COLUMNS.successorDate),
    dummyFlag: getBool(CSV_COLUMNS.dummyFlag),
    nameEn: getValue(CSV_COLUMNS.nameEn)?.substring(0, 300),
    domPrefectureEn: getValue(CSV_COLUMNS.domPrefectureEn)?.substring(0, 100),
    domAddressEn: getValue(CSV_COLUMNS.domAddressEn)?.substring(0, 300),
    domAddressEnImageId: getValue(CSV_COLUMNS.domAddressEnImageId)?.substring(0, 8),
    furigana: getValue(CSV_COLUMNS.furigana)?.substring(0, 500),
    excludeFromSearch: getBool(CSV_COLUMNS.excludeFromSearch),
    updated_at: new Date(),
    created_at: new Date(),
  };
}

async function upsertBatch(batch: (typeof schema.corporation.$inferInsert)[]) {
  if (batch.length === 0) return { inserted: 0, updated: 0 };

  try {
    await db.insert(corporation).values(batch).onConflictDoUpdate({
      target: [corporation.corporateNumber, corporation.id],
      set: {
        processType: sql`EXCLUDED.process_type`,
        correctionType: sql`EXCLUDED.correction_type`,
        updatedDate: sql`EXCLUDED.updated_date`,
        changedDate: sql`EXCLUDED.changed_date`,
        name: sql`EXCLUDED.name`,
        nameImageId: sql`EXCLUDED.name_image_id`,
        corporationType: sql`EXCLUDED.corporation_type`,
        domPrefecture: sql`EXCLUDED.dom_prefecture`,
        domCity: sql`EXCLUDED.dom_city`,
        domAddress: sql`EXCLUDED.dom_address`,
        domAddressImageId: sql`EXCLUDED.dom_address_image_id`,
        prefectureCode: sql`EXCLUDED.prefecture_code`,
        cityCode: sql`EXCLUDED.city_code`,
        postalCode: sql`EXCLUDED.postal_code`,
        foreignAddress: sql`EXCLUDED.foreign_address`,
        foreignAddressImageId: sql`EXCLUDED.foreign_address_image_id`,
        closeDate: sql`EXCLUDED.close_date`,
        closeCause: sql`EXCLUDED.close_cause`,
        successorCorporateNumber: sql`EXCLUDED.successor_corporate_number`,
        successorCause: sql`EXCLUDED.successor_cause`,
        successorDate: sql`EXCLUDED.successor_date`,
        dummyFlag: sql`EXCLUDED.dummy_flag`,
        nameEn: sql`EXCLUDED.name_en`,
        domPrefectureEn: sql`EXCLUDED.dom_prefecture_en`,
        domAddressEn: sql`EXCLUDED.dom_address_en`,
        domAddressEnImageId: sql`EXCLUDED.dom_address_en_image_id`,
        furigana: sql`EXCLUDED.furigana`,
        excludeFromSearch: sql`EXCLUDED.exclude_from_search`,
        updated_at: sql`EXCLUDED.updated_at`,
      }
    });

    return { inserted: batch.length, updated: 0 };
  } catch (error: any) {
    console.error(`\nバッチ処理エラー (最初のレコード: ${batch[0]?.corporateNumber}):`, error.message);
    return { inserted: 0, updated: 0 };
  }
}

async function importCorporations() {
  try {
    console.log("データインポートを開始します...\n");

    const csvPath = resolve(CSV_FILE_PATH);
    if (!existsSync(csvPath)) {
      console.error(`CSVファイルが見つかりません: ${csvPath}`);
      console.error("\n以下の手順を確認してください:");
      console.error("1. 国税庁の法人番号公表サイトからデータをダウンロード");
      console.error("2. ファイルを data/ ディレクトリに保存");
      console.error("3. または CSV_FILE_PATH 環境変数でファイルパスを指定");
      process.exit(1);
    }

    console.log(`ファイルを処理中: ${csvPath}`);

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

    console.log(`総レコード数: ${totalLines.toLocaleString()}件`);
    const progressLogger = new ProgressLogger(totalLines);

    const parser = createReadStream(csvPath)
      .pipe(iconv.decodeStream("utf-8"))
      .pipe(
        parse({
          delimiter: ",",
          quote: '"',
          relax_quotes: true,
          skip_empty_lines: true,
          from_line: 1,
        }),
      );

    let batch: (typeof schema.corporation.$inferInsert)[] = [];
    let insertedCount = 0;
    let updatedCount = 0;
    let lineCount = 0;
    let errorCount = 0;

    console.log("\nデータベースにインポート中...");
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
          console.warn(`行${lineCount}のパースエラー:`, error);
        }
      }

      if (batch.length >= BATCH_SIZE) {
        const result = await upsertBatch(batch);
        insertedCount += result.inserted;
        updatedCount += result.updated;
        batch = [];
        progressLogger.update(BATCH_SIZE);
      }
    }

    if (batch.length > 0) {
      const result = await upsertBatch(batch);
      insertedCount += result.inserted;
      updatedCount += result.updated;
      progressLogger.update(batch.length);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n\nインポート完了`);
    console.log(`  処理時間: ${formatTime(elapsed)}`);
    console.log(`  総レコード数: ${lineCount.toLocaleString()}件`);
    console.log(`  新規挿入: ${insertedCount.toLocaleString()}件`);
    console.log(`  更新: ${updatedCount.toLocaleString()}件`);
    console.log(`  スキップ/エラー: ${errorCount.toLocaleString()}件`);
    console.log(`  平均速度: ${Math.round((insertedCount + updatedCount) / elapsed)} 件/秒`);
  } catch (error) {
    console.error("\nエラー:", error);
    process.exit(1);
  }
}

importCorporations();
