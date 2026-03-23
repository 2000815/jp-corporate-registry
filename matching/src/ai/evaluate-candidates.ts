import { z } from 'zod'
import { flashModel } from './client.js'
import type { InputRow, SearchCandidate } from '../types.js'

const AiEvalResultSchema = z.object({
  selected_index: z.number().int().min(1).nullable(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
})

export type AiEvalResult = z.infer<typeof AiEvalResultSchema>

const systemInstruction = `あなたは日本の法人名寄せの専門家です。
提示された候補の中から、入力情報と最もよく一致する法人を選んでください。

ルール:
- 閉鎖済み法人（close_date あり）は基本的に選ばない
- 同名でも住所が全く異なる場合は選ばない
- 判断できない場合は selected_index に null を返す
- confidenceは0〜100の整数で返す`

function buildPrompt(input: InputRow, candidates: SearchCandidate[]): string {
  const candidateText = candidates.map((c, i) => `
${i + 1}. 法人番号: ${c.corporateNumber}
   正式名称: ${c.name}
   住所: ${c.domPrefecture ?? ''}${c.domCity ?? ''}${c.domAddress ?? ''}
   閉鎖: ${c.closeDate ? `あり（${c.closeDate}）` : 'なし'}
   類似度: ${Math.round(c.similarityScore * 100)}%`).join('\n')

  return `【入力情報】
会社名: ${input.companyName ?? '不明'}
所在地: ${input.address ?? '不明'}

【検索で見つかった候補】
${candidateText}

以下のJSONスキーマで回答してください:
{
  "selected_index": number | null,
  "confidence": number,
  "reasoning": string
}`
}

export async function evaluateCandidates(
  input: InputRow,
  candidates: SearchCandidate[],
): Promise<AiEvalResult> {
  const result = await flashModel.generateContent({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: buildPrompt(input, candidates) }] }],
  })

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  try {
    return AiEvalResultSchema.parse(JSON.parse(text))
  } catch {
    return {
      selected_index: null,
      confidence: 0,
      reasoning: `AI応答パース失敗: ${text.slice(0, 100)}`,
    }
  }
}
