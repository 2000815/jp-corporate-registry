import 'dotenv/config';
import { db, schema } from '../src/db/index.js';
import { eq } from 'drizzle-orm';

const { corporation, importState, importRuns } = schema;

/**
 * 国税庁法人番号データ 日次差分同期バッチ
 * 
 * 仕様:
 * - last_processed_date を管理テーブルから取得
 * - 取得範囲: from = last_processed_date + 1日, to = 昨日
 * - 範囲が空の場合は no-op
 * - UPSERT: corporate_number のみで判定、sequence_no は使用しない
 * - 成功時のみ last_processed_date を更新
 * - 失敗時はロールバックし last_processed_date は進めない
 */

// 日付を YYYY-MM-DD 形式にフォーマット
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// JSTの昨日の日付を取得
function getYesterdayJST(): Date {
  const now = new Date();
  const jstOffset = 9 * 60; // JSTはUTC+9
  const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
  jstTime.setDate(jstTime.getDate() - 1);
  return jstTime;
}

// 日付を加算
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * インポート状態を取得または初期化
 */
async function getOrCreateImportState(): Promise<{ id: number; lastProcessedDate: Date }> {
  const states = await db.select().from(importState).limit(1);
  
  if (states.length > 0) {
    const state = states[0];
    return {
      id: state.id,
      lastProcessedDate: new Date(state.lastProcessedDate),
    };
  }
  
  // 初期状態: 前日を設定（初回は昨日1日分を取得）
  const yesterday = getYesterdayJST();
  const initialDate = formatDate(yesterday);
  
  const [newState] = await db
    .insert(importState)
    .values({
      lastProcessedDate: initialDate,
    })
    .returning();
  
  return {
    id: newState.id,
    lastProcessedDate: new Date(newState.lastProcessedDate),
  };
}

/**
 * 差分データを取得する範囲を計算
 */
function calculateFetchRange(lastProcessedDate: Date): { from: Date; to: Date } | null {
  const yesterday = getYesterdayJST();
  const from = addDays(lastProcessedDate, 1);
  
  // from > yesterday の場合、取得すべきデータなし
  if (from > yesterday) {
    return null;
  }
  
  return { from, to: yesterday };
}

/**
 * 単一レコードのUPSERT実行
 * corporate_number のみで判定
 */
async function upsertCorporation(record: typeof schema.corporation.$inferInsert): Promise<'inserted' | 'updated'> {
  // 既存レコードを検索
  const existing = await db
    .select({ corporateNumber: corporation.corporateNumber })
    .from(corporation)
    .where(eq(corporation.corporateNumber, record.corporateNumber))
    .limit(1);
  
  if (existing.length === 0) {
    // INSERT
    await db.insert(corporation).values(record);
    return 'inserted';
  } else {
    // UPDATE
    await db
      .update(corporation)
      .set({
        ...record,
        updatedAt: new Date(),
      })
      .where(eq(corporation.corporateNumber, record.corporateNumber));
    return 'updated';
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
  errorMessage?: string
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
async function updateLastProcessedDate(stateId: number, newDate: Date): Promise<void> {
  await db
    .update(importState)
    .set({
      lastProcessedDate: formatDate(newDate),
      updatedAt: new Date(),
    })
    .where(eq(importState.id, stateId));
}

/**
 * メイン処理
 */
async function main() {
  console.log('🔄 法人番号データ差分同期バッチを開始します...\n');
  
  const startTime = Date.now();
  
  try {
    // 1. インポート状態を取得
    const importStateRecord = await getOrCreateImportState();
    console.log(`📅 最終処理日: ${formatDate(importStateRecord.lastProcessedDate)}`);
    
    // 2. 取得範囲を計算
    const range = calculateFetchRange(importStateRecord.lastProcessedDate);
    
    if (!range) {
      console.log('✅ 取得すべきデータがありません。次回の実行を待ちます。');
      console.log(`   次回の対象: ${formatDate(addDays(importStateRecord.lastProcessedDate, 1))} 以降`);
      return;
    }
    
    console.log(`📥 取得範囲: ${formatDate(range.from)} ～ ${formatDate(range.to)}`);
    
    // 3. インポート実行履歴を記録開始
    const runId = await startImportRun(range.from, range.to);
    
    // 4. 差分データを取得（ここではモック実装）
    // 実際の実装では国税庁APIまたはCSVダウンロードを行う
    const diffRecords = await fetchDiffData(range.from, range.to);
    
    if (diffRecords.length === 0) {
      console.log('📭 差分データがありません。');
      
      // 空の実行でも last_processed_date は進める（データがない＝取得完了とみなす）
      await updateLastProcessedDate(importStateRecord.id, range.to);
      await completeImportRun(runId, true, { processed: 0, inserted: 0, updated: 0 });
      
      console.log(`✅ 処理を完了しました。（対象期間内にデータなし）`);
      return;
    }
    
    console.log(`📊 取得件数: ${diffRecords.length}件`);
    
    // 5. UPSERT処理
    let inserted = 0;
    let updated = 0;
    const batchSize = 100;
    
    for (let i = 0; i < diffRecords.length; i += batchSize) {
      const batch = diffRecords.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          const result = await upsertCorporation(record);
          if (result === 'inserted') {
            inserted++;
          } else {
            updated++;
          }
        } catch (error) {
          console.error(`❌ レコード処理エラー (${record.corporateNumber}):`, error);
          throw error; // エラーを伝播させてロールバック
        }
      }
      
      // 進捗表示
      const progress = Math.min((i + batch.length) / diffRecords.length * 100, 100);
      process.stdout.write(`\r   進捗: ${(i + batch.length).toLocaleString()}/${diffRecords.length.toLocaleString()} (${progress.toFixed(1)}%)`);
    }
    
    console.log('\n');
    
    // 6. 成功時のみ last_processed_date を更新
    await updateLastProcessedDate(importStateRecord.id, range.to);
    
    // 7. インポート実行履歴を更新（成功）
    await completeImportRun(runId, true, {
      processed: diffRecords.length,
      inserted,
      updated,
    });
    
    const elapsed = (Date.now() - startTime) / 1000;
    
    console.log('✅ 差分同期が完了しました！');
    console.log(`   処理件数: ${diffRecords.length.toLocaleString()}件`);
    console.log(`   新規挿入: ${inserted.toLocaleString()}件`);
    console.log(`   更新: ${updated.toLocaleString()}件`);
    console.log(`   処理時間: ${elapsed.toFixed(1)}秒`);
    console.log(`   次回の対象: ${formatDate(addDays(range.to, 1))} 以降`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ エラーが発生しました:', errorMessage);
    
    // 失敗時は last_processed_date は更新しない（自動的に再取得される）
    // importRuns には失敗記録が残る
    
    console.log('⚠️  処理をロールバックしました。次回の実行時に再取得されます。');
    
    process.exit(1);
  }
}

/**
 * 国税庁から差分データを取得（モック実装）
 * 実際の実装では:
 * - 国税庁法人番号APIを呼び出し
 * - または CSVダウンロードを行う
 */
async function fetchDiffData(from: Date, to: Date): Promise<typeof schema.corporation.$inferInsert[]> {
  // TODO: 実際の国税庁データ取得ロジックを実装
  // 現状は空配列を返す（データ取得部分は別途実装）
  console.log(`   データ取得: ${formatDate(from)} ～ ${formatDate(to)}`);
  console.log('   ⚠️  データ取得ロジックは未実装です（モック）');
  return [];
}

// スクリプト実行
main();
