import fs from 'node:fs'
import type { MatchResult } from '../types.js'

const CSV_HEADERS = [
  'input_id', 'input_corporate_number', 'input_company_name', 'input_address', 'input_phone',
  'outcome', 'confidence', 'matched_corporate_number', 'matched_name',
  'matched_prefecture', 'matched_city', 'matched_address', 'matched_corporation_type',
  'is_closed', 'successor_corporate_number',
  'candidate_2_corporate_number', 'candidate_2_name', 'candidate_2_confidence',
  'candidate_3_corporate_number', 'candidate_3_name', 'candidate_3_confidence',
  'match_method', 'reasoning', 'processed_at',
]

export function writeResultsCsv(results: MatchResult[], outputPath: string): void {
  const lines: string[] = [CSV_HEADERS.join(',')]

  for (const r of results) {
    const c2 = r.candidates[1]
    const c3 = r.candidates[2]

    const row = [
      escape(r.input.inputId),
      escape(r.input.corporateNumber ?? ''),
      escape(r.input.companyName ?? ''),
      escape(r.input.address ?? ''),
      escape(r.input.phone ?? ''),
      r.outcome,
      String(r.confidence),
      escape(r.matched?.corporateNumber ?? ''),
      escape(r.matched?.name ?? ''),
      escape(r.matched?.domPrefecture ?? ''),
      escape(r.matched?.domCity ?? ''),
      escape(r.matched?.domAddress ?? ''),
      escape(r.matched?.corporationType ?? ''),
      r.matched?.closeDate ? 'true' : 'false',
      escape(r.matched?.successorCorporateNumber ?? ''),
      escape(c2?.corporateNumber ?? ''),
      escape(c2?.name ?? ''),
      c2 ? String(Math.round(c2.similarityScore * 100)) : '',
      escape(c3?.corporateNumber ?? ''),
      escape(c3?.name ?? ''),
      c3 ? String(Math.round(c3.similarityScore * 100)) : '',
      r.matchMethod,
      escape(r.reasoning),
      r.processedAt,
    ]
    lines.push(row.join(','))
  }

  // BOM付きUTF-8で出力（Excel対応）
  const bom = '\uFEFF'
  fs.writeFileSync(outputPath, bom + lines.join('\n'), 'utf-8')
}

function escape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
