import { z } from 'zod'
import { flashModelWithTools } from './client.js'
import { searchWithTrgm } from '../searcher/trgm-search.js'
import type { InputRow, SearchCandidate } from '../types.js'
import type pLimitType from 'p-limit'

const MAX_TOOL_CALLS = 3

const AiSearchResultSchema = z.object({
  judgment: z.enum(['matched', 'individual', 'unmatched']),
  corporate_number: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
})

export type AiSearchResult = z.infer<typeof AiSearchResultSchema>

export async function searchWithAI(
  input: InputRow,
  dbLimit: ReturnType<typeof pLimitType>,
): Promise<AiSearchResult> {
  const chat = flashModelWithTools.startChat()
  let toolCallCount = 0

  const initialPrompt = `以下の法人情報を国税庁法人番号DBで検索し、最も適切な法人を特定してください。
ローカル検索では見つかりませんでした。

会社名: ${input.companyName ?? '不明'}
所在地: ${input.address ?? '不明'}

- ツールは最大${MAX_TOOL_CALLS}回まで使用できます
- 個人名の場合は { "judgment": "individual", "corporate_number": null, "confidence": 0, "reasoning": "個人名" } を返してください
- 法人が見つかった場合は { "judgment": "matched", "corporate_number": "13桁番号", "confidence": 60-90, "reasoning": "理由" } を返してください
- 見つからない場合は { "judgment": "unmatched", "corporate_number": null, "confidence": 0, "reasoning": "理由" } を返してください`

  let response = await chat.sendMessage(initialPrompt)

  while (toolCallCount < MAX_TOOL_CALLS) {
    const functionCall = response.response.candidates?.[0]
      ?.content?.parts?.find(p => p.functionCall)?.functionCall

    if (!functionCall) break

    toolCallCount++
    const toolResult = await dbLimit(() =>
      executeTool(functionCall.name, functionCall.args as Record<string, string>)
    )

    response = await chat.sendMessage([{
      functionResponse: {
        name: functionCall.name,
        response: { results: toolResult },
      },
    }])
  }

  const finalText = response.response.candidates?.[0]
    ?.content?.parts?.find(p => p.text)?.text ?? '{}'

  return parseResult(finalText)
}

async function executeTool(
  name: string,
  args: Record<string, string>,
): Promise<SearchCandidate[]> {
  switch (name) {
    case 'search_by_name_with_prefecture':
      return searchWithTrgm({
        normalizedName: args.name,
        prefecture: args.prefecture,
        threshold: 0.5,
        limit: 5,
      })
    case 'search_by_name':
      return searchWithTrgm({
        normalizedName: args.name,
        threshold: 0.7,
        limit: 3,
      })
    default:
      return []
  }
}

function parseResult(text: string): AiSearchResult {
  try {
    // JSONブロックを抽出（マークダウンで囲まれている場合）
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : text
    return AiSearchResultSchema.parse(JSON.parse(jsonStr))
  } catch {
    return {
      judgment: 'unmatched',
      corporate_number: null,
      confidence: 0,
      reasoning: `AI応答パース失敗: ${text.slice(0, 100)}`,
    }
  }
}
