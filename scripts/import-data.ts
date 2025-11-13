import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import iconv from 'iconv-lite';
import { db, schema } from '../src/db/index.js';

const { corporations } = schema;
type NewCorporation = typeof corporations.$inferInsert;

// 設定
const CSV_FILE_PATH = process.env.CSV_FILE_PATH || './data/46_kagoshima_all_20251031.csv';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000', 10);

/**
 * 国税庁CSVをパース（Shift-JIS対応）
 */
function parseCSV(csvContent: string): NewCorporation[] {
  const lines = csvContent.split('\n');
  const result: NewCorporation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = line.split(',').map(col => col.replace(/^"|"$/g, '').trim());

    // 国税庁フォーマット: 列2=法人番号, 列7=名称, 列10=都道府県, 列11=市区町村, 列12=町域番地等
    if (columns.length < 12 || !columns[1] || !columns[6]) continue;

    result.push({
      corporateNumber: columns[1],
      name: columns[6],
      prefectureName: columns[9] || null,
      cityName: columns[10] || null,
      streetNumber: columns[11] || null,
      updatedAt: new Date(),
    });
  }

  return result;
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

    console.log(`📂 ファイルを読み込み中: ${csvPath}`);
    const buffer = await readFile(csvPath);
    const csvContent = iconv.decode(buffer, 'Shift_JIS');
    
    console.log('🔄 CSVを解析中...');
    const corporations = parseCSV(csvContent);
    console.log(`   ✓ ${corporations.length.toLocaleString()} 件のデータを解析しました`);

    if (corporations.length === 0) {
      console.error('❌ インポートするデータがありません');
      process.exit(1);
    }

    // バッチでインポート
    console.log(`\n💾 データベースにインポート中（バッチサイズ: ${BATCH_SIZE}）...`);
    let totalInserted = 0;
    const totalBatches = Math.ceil(corporations.length / BATCH_SIZE);

    for (let i = 0; i < corporations.length; i += BATCH_SIZE) {
      const batch = corporations.slice(i, i + BATCH_SIZE);
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      
      try {
        await db
          .insert(schema.corporations)
          .values(batch)
          .onConflictDoNothing({ target: schema.corporations.corporateNumber });
        
        totalInserted += batch.length;
        
        // 進捗表示
        const progress = ((currentBatch / totalBatches) * 100).toFixed(1);
        process.stdout.write(
          `\r   進捗: ${currentBatch}/${totalBatches} バッチ (${progress}%) - ${totalInserted.toLocaleString()} 件挿入済み`
        );
      } catch (error: any) {
        console.error(`\n⚠️  バッチ ${currentBatch} のインポート中にエラー:`, error.message);
      }
    }

    console.log('\n✅ インポート完了！');
    console.log(`   ${totalInserted.toLocaleString()} 件のデータをインポートしました`);

  } catch (error) {
    console.error('\n❌ エラー:', error);
    process.exit(1);
  }
}

// スクリプト実行
importData();
