import fs from 'node:fs'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import type { InputRow } from '../types.js'

export function readInputCsv(filePath: string): InputRow[] {
  const buffer = fs.readFileSync(filePath)

  // エンコーディング自動判定
  let content: string
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    // BOM付きUTF-8
    content = buffer.toString('utf-8').slice(1)
  } else if (isValidUtf8(buffer)) {
    // 有効なUTF-8
    content = buffer.toString('utf-8')
  } else {
    // UTF-8として無効 → Shift-JISとして扱う
    content = iconv.decode(buffer, 'Shift_JIS')
  }

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[]

  return records.map((record, index) => ({
    inputId: record['input_id'] ?? record['inputId'] ?? String(index + 1),
    corporateNumber: emptyToNull(record['corporate_number'] ?? record['corporateNumber']),
    companyName: emptyToNull(record['company_name'] ?? record['companyName']),
    address: emptyToNull(record['address']),
    phone: emptyToNull(record['phone']),
    rowIndex: index,
  }))
}

function emptyToNull(value: string | undefined): string | null {
  if (!value || value.trim() === '') return null
  return value.trim()
}

function isValidUtf8(buffer: Buffer): boolean {
  try {
    const str = buffer.toString('utf-8')
    // UTF-8として変換した結果に置換文字(U+FFFD)が含まれていないかチェック
    // 含まれていなければ有効なUTF-8
    return !str.includes('\uFFFD')
  } catch {
    return false
  }
}
