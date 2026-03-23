import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'
import type { SearchCandidate } from '../types.js'

const VALID_THRESHOLDS = [0.5, 0.7, 0.85] as const
type ValidThreshold = typeof VALID_THRESHOLDS[number]

interface TrgmSearchOptions {
  normalizedName: string
  coreName?: string
  prefecture?: string | null
  threshold: ValidThreshold
  limit: number
}

export async function searchWithTrgm(opts: TrgmSearchOptions): Promise<SearchCandidate[]> {
  if (!VALID_THRESHOLDS.includes(opts.threshold)) {
    throw new Error(`Invalid threshold: ${opts.threshold}. Must be one of ${VALID_THRESHOLDS.join(', ')}`)
  }

  const thresholdSql = opts.threshold === 0.5
    ? sql`0.5` : opts.threshold === 0.7
    ? sql`0.7` : sql`0.85`

  const prefectureFilter = opts.prefecture
    ? sql`AND dom_prefecture = ${opts.prefecture}`
    : sql``

  const results = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL pg_trgm.similarity_threshold = ${thresholdSql}`)

    const normalizedResults = await tx.execute<{
      corporate_number: string
      name: string
      dom_prefecture: string | null
      dom_city: string | null
      dom_address: string | null
      corporation_type: string | null
      close_date: string | null
      successor_corporate_number: string | null
      similarity_score: number
      matched_field: string
    }>(sql`
      SELECT
        corporate_number,
        name,
        dom_prefecture,
        dom_city,
        dom_address,
        corporation_type,
        close_date,
        successor_corporate_number,
        similarity(name, ${opts.normalizedName}) AS similarity_score,
        'normalized' AS matched_field
      FROM corporation
      WHERE
        exclude_from_search = false
        AND name % ${opts.normalizedName}
        ${prefectureFilter}
      ORDER BY similarity_score DESC
      LIMIT ${opts.limit}
    `)

    let coreResults: Array<typeof normalizedResults[number]> = []

    if (opts.coreName && opts.coreName !== opts.normalizedName) {
      coreResults = await tx.execute(sql`
        SELECT
          corporate_number,
          name,
          prefecture_name,
          city_name,
          street_number,
          corporation_type,
          close_date,
          successor_corporate_number,
          similarity(name, ${opts.coreName}) AS similarity_score,
          'core' AS matched_field
        FROM corporation
        WHERE
          exclude_from_search = false
          AND name % ${opts.coreName}
          ${prefectureFilter}
        ORDER BY similarity_score DESC
        LIMIT ${opts.limit}
      `)
    }

    return [...normalizedResults, ...coreResults]
  })

  // corporate_number で重複排除（最大スコアを採用）
  const deduped = new Map<string, SearchCandidate>()
  for (const row of results) {
    const candidate: SearchCandidate = {
      corporateNumber: row.corporate_number,
      name: row.name,
      domPrefecture: row.dom_prefecture,
      domCity: row.dom_city,
      domAddress: row.dom_address,
      corporationType: row.corporation_type,
      closeDate: row.close_date,
      successorCorporateNumber: row.successor_corporate_number,
      similarityScore: Number(row.similarity_score),
      matchedField: row.matched_field as 'normalized' | 'core',
    }

    const existing = deduped.get(candidate.corporateNumber)
    if (!existing || candidate.similarityScore > existing.similarityScore) {
      deduped.set(candidate.corporateNumber, candidate)
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.similarityScore - a.similarityScore)
}
