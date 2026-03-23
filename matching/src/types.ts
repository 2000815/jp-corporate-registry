export interface InputRow {
  inputId: string
  corporateNumber: string | null
  companyName: string | null
  address: string | null
  phone: string | null
  rowIndex: number
}

export interface NormalizedInput extends InputRow {
  normalizedName: string
  coreName: string
  prefecture: string | null
  entityType: EntityJudgment
  corporateNumberValidation: CorporateNumberValidation
}

export type EntityJudgment = 'corporation' | 'individual' | 'unknown'

export interface CorporateNumberValidation {
  isValid: boolean
  cleaned: string | null
  reason?: string
}

export interface SearchCandidate {
  corporateNumber: string
  name: string
  domPrefecture: string | null
  domCity: string | null
  domAddress: string | null
  corporationType: string | null
  closeDate: string | null
  successorCorporateNumber: string | null
  similarityScore: number
  matchedField: 'normalized' | 'core' | 'direct' | 'exact'
}

export type Outcome = 'confirmed' | 'review_needed' | 'unmatched' | 'skipped' | 'error'

export type MatchMethod =
  | 'direct'
  | 'exact'
  | 'trgm_pref'
  | 'trgm_nopref'
  | 'core'
  | 'ai_eval'
  | 'ai_search'
  | 'none'

export interface MatchResult {
  input: InputRow
  outcome: Outcome
  confidence: number
  matchMethod: MatchMethod
  matched: SearchCandidate | null
  candidates: SearchCandidate[]
  reasoning: string
  processedAt: string
}

export interface LocalSearchResult {
  outcome: Outcome
  confidence: number
  matchMethod: MatchMethod
  matched: SearchCandidate | null
  candidates: SearchCandidate[]
  reasoning: string
}
