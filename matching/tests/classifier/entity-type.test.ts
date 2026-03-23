import { describe, it, expect } from 'vitest'
import { judgeEntityType } from '../../src/classifier/entity-type.js'

describe('judgeEntityType', () => {
  it('法人格がある場合はcorporationを返す', () => {
    expect(judgeEntityType('株式会社テスト')).toBe('corporation')
    expect(judgeEntityType('有限会社サンプル')).toBe('corporation')
    expect(judgeEntityType('合同会社テスト')).toBe('corporation')
  })

  it('屋号パターンはcorporationを返す', () => {
    expect(judgeEntityType('山田商店')).toBe('corporation')
    expect(judgeEntityType('鈴木建設')).toBe('corporation')
    expect(judgeEntityType('テストシステム')).toBe('corporation')
  })

  it('個人名パターンはindividualを返す', () => {
    expect(judgeEntityType('山田 太郎')).toBe('individual')
    expect(judgeEntityType('田中様')).toBe('individual')
    expect(judgeEntityType('佐藤先生')).toBe('individual')
  })

  it('判定不能はunknownを返す', () => {
    expect(judgeEntityType('テスト')).toBe('unknown')
    expect(judgeEntityType(null)).toBe('unknown')
    expect(judgeEntityType('不明')).toBe('unknown')
  })
})
