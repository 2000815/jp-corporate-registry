import type { NormalizedInput, LocalSearchResult, SearchCandidate, MatchMethod } from '../types.js'
import { searchByCorpNumber } from './direct-search.js'
import { searchExact } from './exact-search.js'
import { searchWithTrgm } from './trgm-search.js'
import { calculateConfidence } from './confidence.js'

const MIN_CORE_NAME_LENGTH = 5

export async function runLocalSearch(input: NormalizedInput): Promise<LocalSearchResult> {
  // 個人名はスキップ
  if (input.entityType === 'individual') {
    return {
      outcome: 'skipped',
      confidence: 0,
      matchMethod: 'none',
      matched: null,
      candidates: [],
      reasoning: '個人名と判定されたためスキップ',
    }
  }

  // Step A: 法人番号直接検索
  if (input.corporateNumberValidation.isValid && input.corporateNumberValidation.cleaned) {
    const result = await searchByCorpNumber(input.corporateNumberValidation.cleaned)
    if (result) {
      return confirmed(result, 'direct', input, '法人番号による直接一致')
    }
    // 法人番号がDBに無い場合、名称検索にフォールバック
  }

  // 名前が空の場合はここで終了
  if (!input.normalizedName) {
    return unmatched([], '会社名が空または不明のためマッチング不可')
  }

  // Step B: 完全一致検索
  const exactResults = await searchExact(input.normalizedName, input.prefecture)
  if (exactResults.length === 1) {
    return confirmed(exactResults[0], 'exact', input, '正規化名称の完全一致')
  }
  if (exactResults.length > 1) {
    // 複数一致 → 候補としてAIに渡す
    return candidateList(exactResults, 'exact', input, `完全一致で${exactResults.length}件ヒット（要AI評価）`)
  }

  // Step C: pg_trgm + 都道府県フィルター
  if (input.prefecture) {
    const trgmResults = await searchWithTrgm({
      normalizedName: input.normalizedName,
      coreName: input.coreName !== input.normalizedName ? input.coreName : undefined,
      prefecture: input.prefecture,
      threshold: 0.5,
      limit: 10,
    })

    if (trgmResults.length > 0) {
      return evaluateTrgmResults(trgmResults, 'trgm_pref', input)
    }
  }

  // Step D-1: pg_trgm 都道府県なし（normalized_name のみ）
  const d1Results = await searchWithTrgm({
    normalizedName: input.normalizedName,
    threshold: 0.7,
    limit: 5,
  })

  if (d1Results.length > 0) {
    return evaluateTrgmResults(d1Results, 'trgm_nopref', input)
  }

  // Step D-2: コア名称検索（ノイズ防止ガード）
  if (
    input.coreName &&
    input.coreName.length >= MIN_CORE_NAME_LENGTH &&
    input.coreName !== input.normalizedName
  ) {
    const d2Results = await searchWithTrgm({
      normalizedName: input.coreName,
      threshold: 0.85,
      limit: 3,
    })

    if (d2Results.length > 0) {
      return evaluateTrgmResults(d2Results, 'core', input)
    }
  }

  // 全不一致
  return unmatched([], 'ローカル検索で候補なし')
}

function evaluateTrgmResults(
  candidates: SearchCandidate[],
  method: MatchMethod,
  input: NormalizedInput,
): LocalSearchResult {
  // 単一候補 + 高スコア → 確定
  if (candidates.length === 1 && candidates[0].similarityScore >= 0.85) {
    return confirmed(candidates[0], method, input,
      `類似度${Math.round(candidates[0].similarityScore * 100)}%で一意マッチ`)
  }

  // 最上位が非常に高スコアで2位と差がある場合 → 確定
  if (candidates.length >= 2) {
    const top = candidates[0]
    const second = candidates[1]
    if (top.similarityScore >= 0.9 && top.similarityScore - second.similarityScore >= 0.1) {
      return confirmed(top, method, input,
        `類似度${Math.round(top.similarityScore * 100)}%で最上位マッチ（2位との差: ${Math.round((top.similarityScore - second.similarityScore) * 100)}%）`)
    }
  }

  // 候補あり → AI評価が必要
  return candidateList(candidates, method, input,
    `${candidates.length}件の候補あり（最高類似度: ${Math.round(candidates[0].similarityScore * 100)}%）`)
}

function confirmed(
  candidate: SearchCandidate,
  method: MatchMethod,
  input: NormalizedInput,
  reasoning: string,
): LocalSearchResult {
  const confidence = calculateConfidence({
    matchMethod: method,
    candidate,
    inputPrefecture: input.prefecture,
    inputAddress: input.address,
    totalCandidates: 1,
  })

  return {
    outcome: confidence >= 75 ? 'confirmed' : 'review_needed',
    confidence,
    matchMethod: method,
    matched: candidate,
    candidates: [candidate],
    reasoning,
  }
}

function candidateList(
  candidates: SearchCandidate[],
  method: MatchMethod,
  input: NormalizedInput,
  reasoning: string,
): LocalSearchResult {
  const topCandidate = candidates[0]
  const confidence = calculateConfidence({
    matchMethod: method,
    candidate: topCandidate,
    inputPrefecture: input.prefecture,
    inputAddress: input.address,
    totalCandidates: candidates.length,
  })

  return {
    outcome: 'review_needed',
    confidence,
    matchMethod: method,
    matched: topCandidate,
    candidates,
    reasoning,
  }
}

function unmatched(candidates: SearchCandidate[], reasoning: string): LocalSearchResult {
  return {
    outcome: 'unmatched',
    confidence: 0,
    matchMethod: 'none',
    matched: null,
    candidates,
    reasoning,
  }
}
