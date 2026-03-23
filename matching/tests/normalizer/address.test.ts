import { describe, it, expect } from 'vitest'
import { extractPrefecture } from '../../src/normalizer/address.js'

describe('extractPrefecture', () => {
  it('東京都を抽出する', () => {
    expect(extractPrefecture('東京都渋谷区道玄坂1-1-1')).toBe('東京都')
  })

  it('大阪府を抽出する', () => {
    expect(extractPrefecture('大阪府大阪市北区梅田1-1')).toBe('大阪府')
  })

  it('北海道を抽出する', () => {
    expect(extractPrefecture('北海道札幌市中央区')).toBe('北海道')
  })

  it('県を抽出する', () => {
    expect(extractPrefecture('神奈川県横浜市')).toBe('神奈川県')
    expect(extractPrefecture('愛知県名古屋市')).toBe('愛知県')
  })

  it('短縮形を補完する', () => {
    expect(extractPrefecture('東京渋谷区')).toBe('東京都')
    expect(extractPrefecture('大阪市北区')).toBe('大阪府')
  })

  it('nullや空文字はnullを返す', () => {
    expect(extractPrefecture(null)).toBeNull()
    expect(extractPrefecture('')).toBeNull()
  })
})
