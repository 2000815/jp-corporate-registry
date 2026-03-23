import pLimit from 'p-limit'
import type { InputRow, NormalizedInput, MatchResult, SearchCandidate } from '../types.js'
import { normalizeCompanyName, extractCoreName } from '../normalizer/company-name.js'
import { extractPrefecture } from '../normalizer/address.js'
import { validateCorporateNumber } from '../normalizer/corporate-number.js'
import { judgeEntityType } from '../classifier/entity-type.js'
import { runLocalSearch } from '../searcher/index.js'
import { calculateConfidence } from '../searcher/confidence.js'
import { ProgressLogger } from './logger.js'

// Lazy imports for AI (only loaded when needed)
let evaluateCandidates: typeof import('../ai/evaluate-candidates.js').evaluateCandidates | null = null
let searchWithAI: typeof import('../ai/search-with-ai.js').searchWithAI | null = null
let callVertexWithRetry: typeof import('../ai/client.js').callVertexWithRetry | null = null

async function loadAiModules() {
  const [evalMod, searchMod, clientMod] = await Promise.all([
    import('../ai/evaluate-candidates.js'),
    import('../ai/search-with-ai.js'),
    import('../ai/client.js'),
  ])
  evaluateCandidates = evalMod.evaluateCandidates
  searchWithAI = searchMod.searchWithAI
  callVertexWithRetry = clientMod.callVertexWithRetry
}

interface ProcessOptions {
  noAi: boolean
  dryRun: boolean
  verbose: boolean
}

const CONCURRENCY = {
  DB: 10,
  AI_B: 5,
  AI_C: 3,
} as const

export async function processBatch(
  rows: InputRow[],
  options: ProcessOptions,
): Promise<MatchResult[]> {
  const logger = new ProgressLogger(rows.length, options.verbose)
  const dbLimit = pLimit(CONCURRENCY.DB)
  const aiBLimit = pLimit(CONCURRENCY.AI_B)
  const aiCLimit = pLimit(CONCURRENCY.AI_C)

  // AI モジュールの遅延読み込み
  if (!options.noAi) {
    try {
      await loadAiModules()
      console.log('Vertex AI 接続準備完了')
    } catch (e) {
      console.warn(`Vertex AI 初期化失敗 (--no-ai モードにフォールバック): ${e instanceof Error ? e.message : e}`)
      options.noAi = true
    }
  }

  // 前処理: 全行を正規化
  console.log(`\n${rows.length}行を前処理中...`)
  const normalizedRows = rows.map(normalizeInput)

  console.log(`検索処理を開始 (DB並行=${CONCURRENCY.DB}${options.noAi ? '' : `, AI-B並行=${CONCURRENCY.AI_B}, AI-C並行=${CONCURRENCY.AI_C}`})...\n`)

  // 結果配列（入力順序保証）
  const results: MatchResult[] = new Array(rows.length)

  const tasks = normalizedRows.map((normalized, index) =>
    dbLimit(async () => {
      try {
        logger.logVerbose(normalized.inputId,
          `${normalized.normalizedName || '(名称なし)'} [${normalized.entityType}] ${normalized.prefecture ?? ''}`)

        const localResult = await runLocalSearch(normalized)

        let finalOutcome = localResult.outcome
        let finalConfidence = localResult.confidence
        let finalMethod = localResult.matchMethod
        let finalMatched = localResult.matched
        let finalCandidates = localResult.candidates
        let finalReasoning = localResult.reasoning

        // AI統合
        if (!options.noAi && evaluateCandidates && searchWithAI && callVertexWithRetry) {
          // Case B: 候補あり + review_needed → AI候補評価
          if (localResult.outcome === 'review_needed' && localResult.candidates.length > 0) {
            try {
              const aiResult = await aiBLimit(() =>
                callVertexWithRetry!(() =>
                  evaluateCandidates!(rows[index], localResult.candidates)
                )
              )

              if (aiResult.selected_index !== null && aiResult.selected_index >= 1 && aiResult.selected_index <= localResult.candidates.length) {
                const selected = localResult.candidates[aiResult.selected_index - 1]
                const confidence = calculateConfidence({
                  matchMethod: 'ai_eval',
                  aiConfidence: aiResult.confidence,
                  inputPrefecture: normalized.prefecture,
                  inputAddress: normalized.address,
                  totalCandidates: 1,
                })

                finalOutcome = confidence >= 75 ? 'confirmed' : 'review_needed'
                finalConfidence = confidence
                finalMethod = 'ai_eval'
                finalMatched = selected
                finalReasoning = `AI評価: ${aiResult.reasoning}`
              } else {
                finalReasoning = `AI判断不能: ${aiResult.reasoning}`
              }

              logger.logVerbose(normalized.inputId, `  AI Case B → ${finalOutcome} (${finalConfidence})`)
            } catch (e) {
              logger.logVerbose(normalized.inputId, `  AI Case B failed: ${e instanceof Error ? e.message : e}`)
            }
          }

          // Case C: unmatched + 名前あり → AI再検索
          if (localResult.outcome === 'unmatched' && normalized.normalizedName) {
            try {
              const aiResult = await aiCLimit(() =>
                callVertexWithRetry!(() =>
                  searchWithAI!(rows[index], dbLimit)
                )
              )

              if (aiResult.judgment === 'matched' && aiResult.corporate_number) {
                finalOutcome = aiResult.confidence >= 75 ? 'confirmed' : 'review_needed'
                finalConfidence = aiResult.confidence
                finalMethod = 'ai_search'
                finalMatched = {
                  corporateNumber: aiResult.corporate_number,
                  name: '',
                  domPrefecture: null,
                  domCity: null,
                  domAddress: null,
                  corporationType: null,
                  closeDate: null,
                  successorCorporateNumber: null,
                  similarityScore: 0,
                  matchedField: 'direct',
                }
                finalReasoning = `AI再検索: ${aiResult.reasoning}`
              } else if (aiResult.judgment === 'individual') {
                finalOutcome = 'skipped'
                finalReasoning = `AI判定: 個人名 (${aiResult.reasoning})`
              } else {
                finalReasoning = `AI再検索でも不一致: ${aiResult.reasoning}`
              }

              logger.logVerbose(normalized.inputId, `  AI Case C → ${finalOutcome} (${finalConfidence})`)
            } catch (e) {
              logger.logVerbose(normalized.inputId, `  AI Case C failed: ${e instanceof Error ? e.message : e}`)
            }
          }
        }

        logger.logVerbose(normalized.inputId,
          `→ ${finalOutcome} (${finalMethod}, confidence=${finalConfidence})`)

        results[index] = {
          input: rows[index],
          outcome: finalOutcome,
          confidence: finalConfidence,
          matchMethod: finalMethod,
          matched: finalMatched,
          candidates: finalCandidates.slice(0, 3),
          reasoning: finalReasoning,
          processedAt: new Date().toISOString(),
        }

        logger.increment(finalOutcome)
      } catch (error) {
        results[index] = {
          input: rows[index],
          outcome: 'error',
          confidence: 0,
          matchMethod: 'none',
          matched: null,
          candidates: [],
          reasoning: `処理エラー: ${error instanceof Error ? error.message : String(error)}`,
          processedAt: new Date().toISOString(),
        }
        logger.logError(normalized.inputId, error)
        logger.increment('error')
      }
    })
  )

  await Promise.all(tasks)
  logger.printSummary()

  return results
}

function normalizeInput(row: InputRow): NormalizedInput {
  const normalizedName = normalizeCompanyName(row.companyName ?? '')
  const coreName = extractCoreName(normalizedName)
  const prefecture = extractPrefecture(row.address)
  const entityType = judgeEntityType(row.companyName)
  const corporateNumberValidation = validateCorporateNumber(row.corporateNumber)

  return {
    ...row,
    normalizedName,
    coreName,
    prefecture,
    entityType,
    corporateNumberValidation,
  }
}
