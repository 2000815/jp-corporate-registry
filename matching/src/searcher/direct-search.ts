import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'
import type { SearchCandidate } from '../types.js'

export async function searchByCorpNumber(corpNumber: string): Promise<SearchCandidate | null> {
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
    WHERE corporate_number = ${corpNumber}
      AND exclude_from_search = false
    LIMIT 1
  `)

  if (results.length === 0) return null

  const row = results[0]
  return {
    corporateNumber: row.corporate_number,
    name: row.name,
    domPrefecture: row.dom_prefecture,
    domCity: row.dom_city,
    domAddress: row.dom_address,
    corporationType: row.corporation_type,
    closeDate: row.close_date,
    successorCorporateNumber: row.successor_corporate_number,
    similarityScore: 1.0,
    matchedField: 'direct',
  }
}
