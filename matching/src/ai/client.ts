import { VertexAI, FunctionDeclarationSchemaType } from '@google-cloud/vertexai'

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID ?? 'jp-corporate-search',
  location: process.env.GCP_LOCATION ?? 'asia-northeast1',
})

// Case B: 候補評価（JSON mode）
export const flashModel = vertexAI.getGenerativeModel({
  model: 'gemini-2.0-flash-001',
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 512,
    responseMimeType: 'application/json',
  },
})

// Case C: function calling（ツール付き）
export const flashModelWithTools = vertexAI.getGenerativeModel({
  model: 'gemini-2.0-flash-001',
  generationConfig: {
    temperature: 0,
    maxOutputTokens: 1024,
  },
  tools: [{
    functionDeclarations: [
      {
        name: 'search_by_name_with_prefecture',
        description: '都道府県を指定して会社名でファジー検索する',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            name: {
              type: FunctionDeclarationSchemaType.STRING,
              description: '検索する会社名（正規化済み）',
            },
            prefecture: {
              type: FunctionDeclarationSchemaType.STRING,
              description: '都道府県名（例: 東京都）',
            },
          },
          required: ['name', 'prefecture'],
        },
      },
      {
        name: 'search_by_name',
        description: '全国から会社名でファジー検索する（都道府県不明の場合のみ使用）',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            name: {
              type: FunctionDeclarationSchemaType.STRING,
              description: '検索する会社名',
            },
          },
          required: ['name'],
        },
      },
    ],
  }],
})

// リトライ（Vertex AI版）
export async function callVertexWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (isQuotaError(error) && attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 60_000)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')
}
