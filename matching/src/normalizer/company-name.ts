// 半角カタカナ → 全角カタカナ変換テーブル
const HALF_TO_FULL_KANA: Record<string, string> = {
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ', 'ｰ': 'ー',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ﾝ': 'ン', 'ﾞ': '゛', 'ﾟ': '゜', '･': '・',
  '｢': '「', '｣': '」',
}

const CORPORATE_TYPE_MAP: Record<string, string> = {
  '㈱': '株式会社', '(株)': '株式会社', '（株）': '株式会社',
  '㈲': '有限会社', '(有)': '有限会社', '（有）': '有限会社',
  '(合)': '合同会社', '（合）': '合同会社',
  '(名)': '合名会社', '（名）': '合名会社',
  '(資)': '合資会社', '（資）': '合資会社',
  '㈳': '一般社団法人', '(社)': '一般社団法人',
  '㈶': '一般財団法人', '(財)': '一般財団法人',
  '社団法人': '一般社団法人',
  '財団法人': '一般財団法人',
}

export const CORPORATE_SUFFIXES = [
  '株式会社', '有限会社', '合同会社', '合名会社', '合資会社',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', 'NPO法人', '医療法人', '学校法人',
  '社会福祉法人', '宗教法人', '農業協同組合', '信用金庫', '信用組合',
]

export function normalizeCompanyName(raw: string): string {
  if (!raw || raw === '不明') return ''

  let result = raw
    .trim()
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 半角カタカナ → 全角
    .replace(/[\uFF65-\uFF9F]/g, c => HALF_TO_FULL_KANA[c] ?? c)
    // 全角スペース → 半角
    .replace(/\u3000/g, ' ')
    // 連続スペースを1つに
    .replace(/\s+/g, ' ')
    .trim()

  // 法人格表記を正規化（長いキーから先にマッチさせる）
  const sortedKeys = Object.keys(CORPORATE_TYPE_MAP).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (result.includes(key)) {
      result = result.replace(key, CORPORATE_TYPE_MAP[key])
    }
  }

  return result
}

export function extractCoreName(normalized: string): string {
  if (!normalized) return ''

  let core = normalized
  for (const suffix of CORPORATE_SUFFIXES) {
    core = core.replace(new RegExp(`^${escapeRegExp(suffix)}\\s*`), '')
    core = core.replace(new RegExp(`\\s*${escapeRegExp(suffix)}$`), '')
  }
  const result = core.trim()
  return result === '' ? normalized : result
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
