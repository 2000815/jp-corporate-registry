import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import { db, schema } from '../src/db/index.js';

const { corporations } = schema;
type NewCorporation = typeof corporations.$inferInsert;

// 設定
const CSV_FILE_PATH = process.env.CSV_FILE_PATH || './data/46_kagoshima_all_20251031.csv';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000', 10);

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
    
    if (now - this.lastLogTime > this.logInterval || this.processedCount === this.totalItems) {
      const elapsed = (now - this.startTime) / 1000; // 秒
      const itemsPerSecond = this.processedCount / elapsed;
      const remainingItems = this.totalItems - this.processedCount;
      const remainingTime = itemsPerSecond > 0 ? remainingItems / itemsPerSecond : 0;
      
      const progress = (this.processedCount / this.totalItems * 100).toFixed(2);
      
      process.stdout.write(
        `\r📊 進捗: ${this.processedCount.toLocaleString()}/${this.totalItems.toLocaleString()} ` +
        `(${progress}%) | 処理速度: ${Math.round(itemsPerSecond)} 件/秒 | ` +
        `残り時間: ${formatTime(remainingTime)}`
      );
      
      this.lastLogTime = now;
    }
  }
}

// 時間をフォーマットするヘルパー関数
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  return [
    h > 0 ? `${h}時間` : '',
    m > 0 ? `${m}分` : '',
    `${s}秒`
  ].filter(Boolean).join(' ');
}

/**
 * データベースにバッチ挿入を行う
 */
async function insertBatch(batch: NewCorporation[]) {
  if (batch.length === 0) return 0;
  
  try {
    await db
      .insert(schema.corporations)
      .values(batch)
      .onConflictDoNothing({ target: schema.corporations.corporateNumber });
    return batch.length;
  } catch (error: any) {
    console.error('\n❌ バッチ挿入エラー:', error.message);
    return 0;
  }
}

/**
 * データインポートのメイン処理
 */
async function importData() {
  try {
    console.log('📥 データインポートを開始します...\n');

    // CSVファイルの存在確認
    const csvPath = resolve(CSV_FILE_PATH);
    if (!existsSync(csvPath)) {
      console.error(`❌ CSVファイルが見つかりません: ${csvPath}`);
      console.error('\n以下の手順を確認してください:');
      console.error('1. 国税庁の法人番号公表サイトからデータをダウンロード');
      console.error('2. ファイルを data/corporation_data.csv として保存');
      console.error('3. または .env ファイルで CSV_FILE_PATH を指定');
      process.exit(1);
    }

    console.log(`📂 ファイルを処理中: ${csvPath}`);
    console.log('🔄 CSVをストリーム処理で読み込み中...');

    // 総行数をカウント（進捗表示用）
    const totalLines = await new Promise<number>((resolve, reject) => {
      let count = 0;
      createReadStream(csvPath)
        .pipe(iconv.decodeStream('Shift_JIS'))
        .on('data', (chunk: Buffer) => {
          // 改行コードの数をカウント
          count += (chunk.toString().match(/\n/g) || []).length;
        })
        .on('end', () => resolve(count - 1)) // ヘッダー行を引く
        .on('error', reject);
    });

    console.log(`   ✓ 総レコード数: ${totalLines.toLocaleString()}件`);
    const progressLogger = new ProgressLogger(totalLines);

    // CSVパーサーの設定
    const parser = createReadStream(csvPath)
      .pipe(iconv.decodeStream('Shift_JIS'))
      .pipe(parse({
        delimiter: ',',
        quote: '"',
        relax_quotes: true,
        skip_empty_lines: true,
        from_line: 2, // ヘッダーをスキップ
      }));

    let batch: NewCorporation[] = [];
    let insertedCount = 0;
    let lineCount = 0;

    console.log('\n💾 データベースにインポート中...');
    const startTime = Date.now();

    for await (const record of parser) {
      lineCount++;
      
      // レコードをパース
      const corporation: NewCorporation = {
        corporateNumber: record[1],
        name: record[6],
        prefectureName: record[9] || null,
        cityName: record[10] || null,
        streetNumber: record[11] || null,
        updatedAt: new Date(),
      };

      batch.push(corporation);

      // バッチサイズに達したらDBに挿入
      if (batch.length >= BATCH_SIZE) {
        const inserted = await insertBatch(batch);
        insertedCount += inserted;
        batch = [];
        progressLogger.update(inserted);
      }
    }

    // 残りのレコードを挿入
    if (batch.length > 0) {
      const inserted = await insertBatch(batch);
      insertedCount += inserted;
      progressLogger.update(inserted);
    }

    const elapsed = (Date.now() - startTime) / 1000; // 秒
    console.log(`\n\n✅ インポート完了！`);
    console.log(`   - 処理時間: ${formatTime(elapsed)}`);
    console.log(`   - 総レコード数: ${lineCount.toLocaleString()}件`);
    console.log(`   - 挿入/更新件数: ${insertedCount.toLocaleString()}件`);
    console.log(`   - スキップ件数: ${(lineCount - insertedCount).toLocaleString()}件`);
    console.log(`   - 平均速度: ${Math.round(insertedCount / elapsed)} 件/秒`);

  } catch (error) {
    console.error('\n❌ エラー:', error);
    process.exit(1);
  }
}

// スクリプト実行
importData();
