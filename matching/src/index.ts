import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { readInputCsv } from './io/csv-reader.js'
import { writeResultsCsv } from './io/csv-writer.js'
import { processBatch } from './batch/processor.js'
import { closeDb } from './db/index.js'

const TEMPLATE_CSV = `input_id,corporate_number,company_name,address,phone
1,,株式会社サンプル,東京都渋谷区道玄坂1-1-1,03-1234-5678
2,7000012050002,国税庁,,
3,,サンプル商事,大阪府大阪市北区梅田1-1,
4,,,東京都新宿区,,
5,,不明,,090-1234-5678
`

interface CliOptions {
  input?: string
  output?: string
  template: boolean
  noAi: boolean
  dryRun: boolean
  verbose: boolean
  resume: boolean
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    template: false,
    noAi: false,
    dryRun: false,
    verbose: false,
    resume: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
      case '-i':
        opts.input = args[++i]
        break
      case '--output':
      case '-o':
        opts.output = args[++i]
        break
      case '--template':
        opts.template = true
        break
      case '--no-ai':
        opts.noAi = true
        break
      case '--dry-run':
        opts.dryRun = true
        opts.noAi = true // dry-run implies no-ai
        break
      case '--verbose':
      case '-v':
        opts.verbose = true
        break
      case '--resume':
        opts.resume = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return opts
}

function printHelp() {
  console.log(`
corporation-matching - 法人名寄せツール

Usage:
  npx tsx src/index.ts --input <csv> [options]
  npx tsx src/index.ts --template [--output <dir>]

Options:
  --input, -i <path>    入力CSVファイルパス (必須)
  --output, -o <path>   出力先ディレクトリ (デフォルト: カレント)
  --template            入力CSVテンプレートを出力して終了
  --no-ai               AI呼び出しを無効化（ローカル検索のみ）
  --dry-run             DB検索のみ実行、AI呼び出しスキップ
  --verbose, -v         詳細ログ出力
  --resume              チェックポイントから再開
  --help, -h            ヘルプ表示
`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  // テンプレート出力モード
  if (opts.template) {
    const outputDir = opts.output ?? '.'
    const outputPath = path.join(outputDir, 'matching_template.csv')
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(outputPath, '\uFEFF' + TEMPLATE_CSV, 'utf-8')
    console.log(`テンプレートCSVを出力しました: ${outputPath}`)
    return
  }

  // 入力チェック
  if (!opts.input) {
    console.error('エラー: --input オプションで入力CSVファイルを指定してください')
    console.error('ヘルプ: --help')
    process.exit(1)
  }

  if (!fs.existsSync(opts.input)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${opts.input}`)
    process.exit(1)
  }

  const outputDir = opts.output ?? '.'
  fs.mkdirSync(outputDir, { recursive: true })

  console.log('=== corporation-matching v0.1.0 ===')
  console.log(`入力: ${opts.input}`)
  console.log(`出力: ${outputDir}`)
  console.log(`モード: ${opts.dryRun ? 'dry-run' : opts.noAi ? 'no-ai' : 'full'}`)

  try {
    // CSV読み込み
    const rows = readInputCsv(opts.input)
    console.log(`${rows.length}行を読み込みました`)

    // バッチ処理
    const results = await processBatch(rows, {
      noAi: opts.noAi,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    })

    // CSV出力
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outputPath = path.join(outputDir, `matching_result_${timestamp}.csv`)
    writeResultsCsv(results, outputPath)
    console.log(`\n結果CSVを出力しました: ${outputPath}`)
  } catch (error) {
    console.error('致命的エラー:', error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await closeDb()
  }
}

main()
