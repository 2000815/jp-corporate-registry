import type { CorporateNumberValidation } from '../types.js'

export function validateCorporateNumber(raw: string | null): CorporateNumberValidation {
  if (!raw || raw.trim() === '') {
    return { isValid: false, cleaned: null }
  }

  const cleaned = raw.replace(/[-\s\u3000]/g, '')

  if (!/^\d{13}$/.test(cleaned)) {
    return { isValid: false, cleaned: null, reason: '13桁の数字ではない' }
  }

  // チェックディジット検証（国税庁方式）
  const check = Number(cleaned[0])
  const body = cleaned.slice(1)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const p = Number(body[11 - i])
    const q = (i % 2 === 0) ? 1 : 2
    sum += p * q
  }
  const remainder = sum % 9
  const expected = 9 - remainder

  if (check !== expected) {
    return {
      isValid: false,
      cleaned,
      reason: `チェックディジット不正（期待値: ${expected}, 実際: ${check}）`,
    }
  }

  return { isValid: true, cleaned }
}
