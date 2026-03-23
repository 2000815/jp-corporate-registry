import type { SearchCandidate, MatchMethod } from '../types.js'

interface ScoreInput {
  matchMethod: MatchMethod
  candidate?: SearchCandidate
  aiConfidence?: number
  inputPrefecture: string | null
  inputAddress: string | null
  totalCandidates: number
}

export function calculateConfidence(input: ScoreInput): number {
  switch (input.matchMethod) {
    case 'direct':
      return 100
    case 'exact':
      return input.totalCandidates === 1 ? 95 : 90
  }

  if (input.matchMethod === 'ai_eval' || input.matchMethod === 'ai_search') {
    return Math.max(0, Math.min(100, input.aiConfidence ?? 50))
  }

  const { candidate } = input
  if (!candidate) return 0

  // 基礎点（0〜80）
  let score = Math.round(candidate.similarityScore * 80)

  // 加点
  if (input.inputPrefecture && candidate.domPrefecture === input.inputPrefecture) {
    score += 8
  }
  if (input.inputAddress && candidate.domCity && input.inputAddress.includes(candidate.domCity)) {
    score += 5
  }
  if (input.totalCandidates === 1) {
    score += 4
  }

  // 減点
  if (candidate.closeDate !== null) {
    score -= 20
  }
  if (input.totalCandidates >= 5) {
    score -= 8
  }
  if (input.matchMethod === 'core') {
    score -= 5
  }

  return Math.max(0, Math.min(100, score))
}
