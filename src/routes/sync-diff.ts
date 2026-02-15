import { defineEventHandler, createError, readBody, getHeader } from "h3";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { readdir } from "node:fs/promises";

const { corporation, importState, importRuns } = schema;

/**
 * APIキー認証
 */
function authenticateApiKey(event: any): boolean {
  const apiKey = getHeader(event, "x-api-key");
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    console.warn("⚠️ API_KEY環境変数が設定されていません");
    return false;
  }

  return apiKey === validApiKey;
}

/**
 * 日付を YYYY-MM-DD 形式にフォーマット
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 日付を加算
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * JSTの昨日の日付を取得
 */
function getYesterdayJST(): Date {
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
  jstTime.setDate(jstTime.getDate() - 1);
  return jstTime;
}

/**
 * インポート状態を取得または初期化
 */
async function getOrCreateImportState(): Promise<{
  id: number;
  lastProcessedDate: Date;
}> {
  const states = await db.select().from(importState).limit(1);

  if (states.length > 0) {
    const state = states[0];
    return {
      id: state.id,
      lastProcessedDate: new Date(state.lastProcessedDate),
    };
  }

  // 初期状態: 前日を設定
  const yesterday = getYesterdayJST();
  const initialDate = formatDate(yesterday);

  const [newState] = await db
    .insert(importState)
    .values({ lastProcessedDate: initialDate })
    .returning();

  return {
    id: newState.id,
    lastProcessedDate: new Date(newState.lastProcessedDate),
  };
}

/**
 * 差分データを取得する範囲を計算
 */
function calculateFetchRange(
  lastProcessedDate: Date,
): { from: Date; to: Date } | null {
  const yesterday = getYesterdayJST();
  const from = addDays(lastProcessedDate, 1);

  if (from > yesterday) {
    return null;
  }

  return { from, to: yesterday };
}

/**
 * 単一レコードのUPSERT実行
 */
async function upsertCorporation(
  record: typeof schema.corporation.$inferInsert,
): Promise<"inserted" | "updated"> {
  const existing = await db
    .select({ corporateNumber: corporation.corporateNumber })
    .from(corporation)
    .where(eq(corporation.corporateNumber, record.corporateNumber))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(corporation).values(record);
    return "inserted";
  } else {
    const { createdAt, ...updateData } = record;
    await db
      .update(corporation)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(corporation.corporateNumber, record.corporateNumber));
    return "updated";
  }
}

/**
 * インポート実行履歴を記録開始
 */
async function startImportRun(fromDate: Date, toDate: Date): Promise<number> {
  const [run] = await db
    .insert(importRuns)
    .values({
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate),
      startedAt: new Date(),
      success: false,
    })
    .returning();

  return run.id;
}

/**
 * インポート実行履歴を更新（完了時）
 */
async function completeImportRun(
  runId: number,
  success: boolean,
  stats: { processed: number; inserted: number; updated: number },
  errorMessage?: string,
): Promise<void> {
  await db
    .update(importRuns)
    .set({
      completedAt: new Date(),
      success,
      processedCount: stats.processed,
      insertedCount: stats.inserted,
      updatedCount: stats.updated,
      errorMessage: errorMessage || null,
    })
    .where(eq(importRuns.id, runId));
}

/**
 * last_processed_date を更新
 */
async function updateLastProcessedDate(
  stateId: number,
  newDate: Date,
): Promise<void> {
  await db
    .update(importState)
    .set({ lastProcessedDate: formatDate(newDate), updatedAt: new Date() })
    .where(eq(importState.id, stateId));
}

/**
 * CSVレコードをパース
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
    id: getInt(0) ?? 0,
    corporateNumber: getValue(1) ?? "",
    processType: getValue(2) ?? "",
    correctionType: getValue(3) ?? "0",
    updatedDate: getDate(4) ?? formatDate(new Date()),
    changedDate: getDate(5),
    name: getValue(6),
    nameImageId: getValue(7),
    corporationType: getValue(8),
    prefectureName: getValue(9),
    cityName: getValue(10),
    streetNumber: getValue(11),
    addressImageId: getValue(12),
    prefectureCode: getValue(13),
    cityCode: getValue(14),
    postalCode: getValue(15),
    foreignAddress: getValue(16),
    foreignAddressImageId: getValue(17),
    closeDate: getDate(18),
    closeCause: getValue(19),
    successorCorporateNumber: getValue(20),
    successorCause: getValue(21),
    successorDate: getDate(22),
    dummyFlag: getBool(23),
    nameEn: getValue(24),
    prefectureNameEn: getValue(25),
    streetNumberEn: getValue(26),
    addressEnImageId: getValue(27),
    furigana: getValue(28),
    excludeFromSearch: getBool(29),
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

/**
 * CSVファイルから差分データを読み込む
 */
async function loadDiffDataFromCsv(
  from: Date,
  to: Date,
): Promise<(typeof schema.corporation.$inferInsert)[]> {
  const csvPath = process.env.CSV_PATH || "./data";

  if (!existsSync(csvPath)) {
    throw new Error(`CSVパスが見つかりません: ${csvPath}`);
  }

  const files = await readdir(csvPath);
  const csvFiles = files
    .filter((f) => f.endsWith(".csv"))
    .map((f) => resolve(csvPath, f));

  if (csvFiles.length === 0) {
    throw new Error(`CSVファイルが見つかりません: ${csvPath}`);
  }

  const allRecords: (typeof schema.corporation.$inferInsert)[] = [];

  for (const filePath of csvFiles) {
    const records: (typeof schema.corporation.$inferInsert)[] = [];
    let lineCount = 0;
    let errorCount = 0;

    const parser = createReadStream(filePath)
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

    for await (const record of parser) {
      lineCount++;
      try {
        if (Array.isArray(record) && record.length >= 30) {
          const parsed = parseCsvRecord(record);
          if (parsed.corporateNumber && parsed.corporateNumber.length === 13) {
            // 日付範囲でフィルタ
            const recordDate = new Date(parsed.updatedDate);
            if (recordDate >= from && recordDate <= to) {
              records.push(parsed);
            }
          }
        }
      } catch (error) {
        errorCount++;
      }
    }

    allRecords.push(...records);
  }

  return allRecords;
}

/**
 * 差分同期エンドポイント
 * POST /api/sync/diff
 */
export default defineEventHandler(async (event) => {
  // APIキー認証
  if (!authenticateApiKey(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      data: { error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
    });
  }

  const startTime = Date.now();

  try {
    // リクエストボディ取得（オプション）
    const body = await readBody(event).catch(() => ({}));
    const customFromDate = body?.fromDate ? new Date(body.fromDate) : null;
    const customToDate = body?.toDate ? new Date(body.toDate) : null;

    // 1. インポート状態を取得
    const importStateRecord = await getOrCreateImportState();

    // 2. 取得範囲を計算（カスタム日付優先）
    let range: { from: Date; to: Date } | null;

    if (customFromDate && customToDate) {
      range = { from: customFromDate, to: customToDate };
    } else {
      range = calculateFetchRange(importStateRecord.lastProcessedDate);
    }

    if (!range) {
      return {
        success: true,
        message: "No data to sync",
        range: null,
        stats: { processed: 0, inserted: 0, updated: 0 },
        elapsedSeconds: 0,
      };
    }

    // 3. インポート実行履歴を記録開始
    const runId = await startImportRun(range.from, range.to);

    // 4. 差分データを取得
    const diffRecords = await loadDiffDataFromCsv(range.from, range.to);

    if (diffRecords.length === 0) {
      await updateLastProcessedDate(importStateRecord.id, range.to);
      await completeImportRun(runId, true, {
        processed: 0,
        inserted: 0,
        updated: 0,
      });

      return {
        success: true,
        message: "No diff records found in range",
        range: { from: formatDate(range.from), to: formatDate(range.to) },
        stats: { processed: 0, inserted: 0, updated: 0 },
        elapsedSeconds: (Date.now() - startTime) / 1000,
      };
    }

    // 5. UPSERT処理
    let inserted = 0;
    let updated = 0;
    const batchSize = 100;

    for (let i = 0; i < diffRecords.length; i += batchSize) {
      const batch = diffRecords.slice(i, i + batchSize);

      for (const record of batch) {
        const result = await upsertCorporation(record);
        if (result === "inserted") inserted++;
        else updated++;
      }
    }

    // 6. 成功時のみlast_processed_dateを更新
    await updateLastProcessedDate(importStateRecord.id, range.to);
    await completeImportRun(runId, true, {
      processed: diffRecords.length,
      inserted,
      updated,
    });

    const elapsed = (Date.now() - startTime) / 1000;

    return {
      success: true,
      range: { from: formatDate(range.from), to: formatDate(range.to) },
      stats: {
        processed: diffRecords.length,
        inserted,
        updated,
      },
      elapsedSeconds: elapsed,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Sync error:", errorMessage);

    throw createError({
      statusCode: 500,
      statusMessage: "Internal Server Error",
      data: { error: { code: "SYNC_ERROR", message: errorMessage } },
    });
  }
});
