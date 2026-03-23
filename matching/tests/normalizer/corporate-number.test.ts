import { describe, it, expect } from 'vitest'
import { validateCorporateNumber } from '../../src/normalizer/corporate-number.js'

describe('validateCorporateNumber', () => {
  it('正しい法人番号を検証する（国税庁: 7000012050002）', () => {
    // 国税庁自身の法人番号
    const result = validateCorporateNumber('7000012050002')
    expect(result.isValid).toBe(true)
    expect(result.cleaned).toBe('7000012050002')
  })

  it('ハイフン付きの法人番号を処理する', () => {
    const result = validateCorporateNumber('7-0000-1205-0002')
    expect(result.isValid).toBe(true)
    expect(result.cleaned).toBe('7000012050002')
  })

  it('nullや空文字はinvalidを返す', () => {
    expect(validateCorporateNumber(null).isValid).toBe(false)
    expect(validateCorporateNumber('').isValid).toBe(false)
  })

  it('13桁でない場合はinvalidを返す', () => {
    const result = validateCorporateNumber('12345')
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('13桁')
  })

  it('チェックディジットが不正な場合はinvalidを返す', () => {
    const result = validateCorporateNumber('1000012050002')
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('チェックディジット')
  })
})
