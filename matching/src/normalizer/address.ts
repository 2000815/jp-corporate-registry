const PREFECTURE_PATTERN =
  /^(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/

const PREFECTURE_ALIAS: Record<string, string> = {
  '東京': '東京都',
  '大阪': '大阪府',
  '京都': '京都府',
  '北海道': '北海道',
}

export function extractPrefecture(address: string | null): string | null {
  if (!address) return null

  const trimmed = address.trim()

  // まず正規パターンでマッチ
  const match = trimmed.match(PREFECTURE_PATTERN)
  if (match) return match[1]

  // 短縮形の補完（"東京" → "東京都"）
  for (const [alias, full] of Object.entries(PREFECTURE_ALIAS)) {
    if (trimmed.startsWith(alias)) return full
  }

  return null
}
