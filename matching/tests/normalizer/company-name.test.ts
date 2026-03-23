import { describe, it, expect } from 'vitest'
import { normalizeCompanyName, extractCoreName } from '../../src/normalizer/company-name.js'

describe('normalizeCompanyName', () => {
  it('全角英数字を半角に変換する', () => {
    expect(normalizeCompanyName('Ａ１Ｂ２')).toBe('A1B2')
  })

  it('半角カタカナを全角に変換する', () => {
    expect(normalizeCompanyName('ｱｲｳ')).toBe('アイウ')
  })

  it('法人格略称を正規化する', () => {
    expect(normalizeCompanyName('㈱テスト')).toBe('株式会社テスト')
    expect(normalizeCompanyName('（株）テスト')).toBe('株式会社テスト')
    expect(normalizeCompanyName('(株)テスト')).toBe('株式会社テスト')
  })

  it('㈲を有限会社に正規化する', () => {
    expect(normalizeCompanyName('㈲サンプル')).toBe('有限会社サンプル')
  })

  it('全角スペースを半角に、連続スペースを1つに', () => {
    expect(normalizeCompanyName('テスト　　会社')).toBe('テスト 会社')
  })

  it('空文字や不明はそのまま空文字を返す', () => {
    expect(normalizeCompanyName('')).toBe('')
    expect(normalizeCompanyName('不明')).toBe('')
  })

  it('前後の空白をtrimする', () => {
    expect(normalizeCompanyName('  株式会社テスト  ')).toBe('株式会社テスト')
  })
})

describe('extractCoreName', () => {
  it('前置の法人格を除去する', () => {
    expect(extractCoreName('株式会社サンプル')).toBe('サンプル')
  })

  it('後置の法人格を除去する', () => {
    expect(extractCoreName('サンプル株式会社')).toBe('サンプル')
  })

  it('法人格がない場合はそのまま返す', () => {
    expect(extractCoreName('サンプル商事')).toBe('サンプル商事')
  })

  it('法人格除去で空になる場合は元文字列を返す', () => {
    expect(extractCoreName('株式会社')).toBe('株式会社')
  })

  it('NPO法人を除去する', () => {
    expect(extractCoreName('NPO法人テスト')).toBe('テスト')
  })
})
