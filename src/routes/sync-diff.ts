import { defineEventHandler, createError, readBody, getHeader } from "h3";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { readdir } from "node:fs/promises";
import {
  parseCsvRecord,
  upsertCorporation,
  formatDate,
  addDays,
  getYesterdayJST,
} from "../utils/csv.js";

const { importState, importRuns } = schema;

/**
 * APIキー認証
 */
function authenticateApiKey(event: any): boolean {
  const apiKey = getHeader(event, "x-api-key");
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    console.warn("API_KEY環境変数が設定されていません");
    return false;
  }

  return apiKey === validApiKey;
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
    .set({ lastProcessedDate: formatDate(newDate), updated_at: new Date() })
    .where(eq(importState.id, stateId));
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
      try {
        if (Array.isArray(record) && record.length >= 30) {
          const parsed = parseCsvRecord(record);
          if (parsed.corporateNumber && parsed.corporateNumber.length === 13) {
            const recordDate = new Date(parsed.updatedDate);
            if (recordDate >= from && recordDate <= to) {
              records.push(parsed);
            }
          }
        }
      } catch {
        // skip invalid records
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
  if (!authenticateApiKey(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      data: { error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
    });
  }

  const startTime = Date.now();

  try {
    const body = await readBody(event).catch(() => ({}));
    const customFromDate = body?.fromDate ? new Date(body.fromDate) : null;
    const customToDate = body?.toDate ? new Date(body.toDate) : null;

    const importStateRecord = await getOrCreateImportState();

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

    const runId = await startImportRun(range.from, range.to);

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

    let inserted = 0;
    let updated = 0;

    for (const record of diffRecords) {
      const result = await upsertCorporation(record);
      if (result === "inserted") inserted++;
      else updated++;
    }

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
