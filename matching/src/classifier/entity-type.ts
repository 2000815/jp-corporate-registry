import type { EntityJudgment } from '../types.js'

const CORPORATION_PATTERNS = [
  /株式会社|有限会社|合同会社|合名会社|合資会社/,
  /一般社団法人|一般財団法人|公益社団法人|公益財団法人/,
  /特定非営利活動法人|NPO法人|医療法人|学校法人/,
  /社会福祉法人|宗教法人|農業協同組合|信用金庫|信用組合/,
  /㈱|㈲|㈳|㈶/,
  /(?:商店|工務店|農園|農場|建設|製作所|工業|産業|興業|開発)$/,
  /(?:サービス|システム|フーズ|フード|ホールディングス)$/,
]

const INDIVIDUAL_PATTERNS = [
  /^[\u4E00-\u9FFF]{1,4}[\s\u3000][\u4E00-\u9FFF]{1,4}$/,
  /[様氏]$|さん$|くん$|先生$/,
]

export function judgeEntityType(companyName: string | null): EntityJudgment {
  if (!companyName || companyName === '不明') return 'unknown'

  for (const pattern of INDIVIDUAL_PATTERNS) {
    if (pattern.test(companyName)) return 'individual'
  }
  for (const pattern of CORPORATION_PATTERNS) {
    if (pattern.test(companyName)) return 'corporation'
  }

  return 'unknown'
}
