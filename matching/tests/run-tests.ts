import assert from 'node:assert'
import { normalizeCompanyName, extractCoreName } from '../src/normalizer/company-name.js'
import { extractPrefecture } from '../src/normalizer/address.js'
import { validateCorporateNumber } from '../src/normalizer/corporate-number.js'
import { judgeEntityType } from '../src/classifier/entity-type.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  PASS: ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL: ${name}`)
    console.log(`    ${e instanceof Error ? e.message : e}`)
  }
}

console.log('\n=== normalizeCompanyName ===')
test('全角英数字→半角', () => assert.strictEqual(normalizeCompanyName('Ａ１Ｂ２'), 'A1B2'))
test('半角カタカナ→全角', () => assert.strictEqual(normalizeCompanyName('ｱｲｳ'), 'アイウ'))
test('㈱→株式会社', () => assert.strictEqual(normalizeCompanyName('㈱テスト'), '株式会社テスト'))
test('（株）→株式会社', () => assert.strictEqual(normalizeCompanyName('（株）テスト'), '株式会社テスト'))
test('㈲→有限会社', () => assert.strictEqual(normalizeCompanyName('㈲サンプル'), '有限会社サンプル'))
test('全角スペース正規化', () => assert.strictEqual(normalizeCompanyName('テスト\u3000\u3000会社'), 'テスト 会社'))
test('空文字→空文字', () => assert.strictEqual(normalizeCompanyName(''), ''))
test('不明→空文字', () => assert.strictEqual(normalizeCompanyName('不明'), ''))
test('trim', () => assert.strictEqual(normalizeCompanyName('  株式会社テスト  '), '株式会社テスト'))

console.log('\n=== extractCoreName ===')
test('前置法人格除去', () => assert.strictEqual(extractCoreName('株式会社サンプル'), 'サンプル'))
test('後置法人格除去', () => assert.strictEqual(extractCoreName('サンプル株式会社'), 'サンプル'))
test('法人格なし', () => assert.strictEqual(extractCoreName('サンプル商事'), 'サンプル商事'))
test('法人格のみ→元文字列', () => assert.strictEqual(extractCoreName('株式会社'), '株式会社'))
test('NPO法人除去', () => assert.strictEqual(extractCoreName('NPO法人テスト'), 'テスト'))

console.log('\n=== extractPrefecture ===')
test('東京都', () => assert.strictEqual(extractPrefecture('東京都渋谷区道玄坂1-1-1'), '東京都'))
test('大阪府', () => assert.strictEqual(extractPrefecture('大阪府大阪市北区梅田1-1'), '大阪府'))
test('北海道', () => assert.strictEqual(extractPrefecture('北海道札幌市中央区'), '北海道'))
test('神奈川県', () => assert.strictEqual(extractPrefecture('神奈川県横浜市'), '神奈川県'))
test('短縮形:東京', () => assert.strictEqual(extractPrefecture('東京渋谷区'), '東京都'))
test('null', () => assert.strictEqual(extractPrefecture(null), null))

console.log('\n=== validateCorporateNumber ===')
test('国税庁法人番号', () => {
  const r = validateCorporateNumber('7000012050002')
  assert.strictEqual(r.isValid, true)
})
test('ハイフン付き', () => {
  const r = validateCorporateNumber('7-0000-1205-0002')
  assert.strictEqual(r.isValid, true)
  assert.strictEqual(r.cleaned, '7000012050002')
})
test('null→invalid', () => assert.strictEqual(validateCorporateNumber(null).isValid, false))
test('短い→invalid', () => {
  const r = validateCorporateNumber('12345')
  assert.strictEqual(r.isValid, false)
})
test('チェックディジット不正', () => {
  const r = validateCorporateNumber('1000012050002')
  assert.strictEqual(r.isValid, false)
})

console.log('\n=== judgeEntityType ===')
test('株式会社→corporation', () => assert.strictEqual(judgeEntityType('株式会社テスト'), 'corporation'))
test('屋号→corporation', () => assert.strictEqual(judgeEntityType('山田商店'), 'corporation'))
test('個人名→individual', () => assert.strictEqual(judgeEntityType('山田 太郎'), 'individual'))
test('敬称→individual', () => assert.strictEqual(judgeEntityType('田中様'), 'individual'))
test('不明→unknown', () => assert.strictEqual(judgeEntityType('テスト'), 'unknown'))
test('null→unknown', () => assert.strictEqual(judgeEntityType(null), 'unknown'))

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
