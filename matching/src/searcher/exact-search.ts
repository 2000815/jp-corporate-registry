import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'
import type { SearchCandidate } from '../types.js'

export async function searchExact(normalizedName: string, prefecture: string | null): Promise<SearchCandidate[]> {
  const results = await db.execute<{
    corporate_number: string
    name: string
    dom_prefecture: string | null
    dom_city: string | null
    dom_address: string | null
    corporation_type: string | null
    close_date: string | null
    successor_corporate_number: string | null
  }>(sql`
    SELECT
      corporate_number,
      name,
      dom_prefecture,
      dom_city,
      dom_address,
      corporation_type,
      close_date,
      successor_corporate_number
    FROM corporation
    WHERE lower(name) = lower(${normalizedName})
      AND exclude_from_search = false
    ORDER BY
      CASE WHEN close_date IS NULL THEN 0 ELSE 1 END,
      corporate_number
    LIMIT 10
  `)

  let candidates: SearchCandidate[] = results.map(row => ({
    corporateNumber: row.corporate_number,
    name: row.name,
    domPrefecture: row.dom_prefecture,
    domCity: row.dom_city,
    domAddress: row.dom_address,
    corporationType: row.corporation_type,
    closeDate: row.close_date,
    successorCorporateNumber: row.successor_corporate_number,
    similarityScore: 1.0,
    matchedField: 'exact' as const,
  }))

  // 複数一致の場合、都道府県で絞り込み
  // 複数一致の場合、都道府県で絞り込み
  if (candidates.length > 1 && prefecture) {
    const filtered = candidates.filter(c => c.domPrefecture === prefecture)
    if (filtered.length > 0) {
      candidates = filtered
    }
  }

  return candidates
}
