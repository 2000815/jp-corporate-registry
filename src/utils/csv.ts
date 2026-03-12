import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const { corporation } = schema;

/**
 * 国税庁法人番号データCSVのカラムインデックス定義
 * CSVはヘッダーなし、カンマ区切り
 */
export const CSV_COLUMNS = {
  sequenceNumber: 0, // 一連番号
  corporateNumber: 1, // 法人番号
  processType: 2, // 処理区分
  correctionType: 3, // 訂正区分
  updatedDate: 4, // 更新年月日
  changedDate: 5, // 変更年月日
  name: 6, // 商号又は名称
  nameImageId: 7, // 商号又は名称イメージID
  corporationType: 8, // 法人種別
  domPrefecture: 9, // 国内所在地（都道府県）
  domCity: 10, // 国内所在地（市区町村）
  domAddress: 11, // 国内所在地（丁目番地等）
  domAddressImageId: 12, // 国内所在地イメージID
  prefectureCode: 13, // 都道府県コード
  cityCode: 14, // 市区町村コード
  postalCode: 15, // 郵便番号
  foreignAddress: 16, // 国外所在地
  foreignAddressImageId: 17, // 国外所在地イメージID
  closeDate: 18, // 登記記録の閉鎖等年月日
  closeCause: 19, // 登記記録の閉鎖等の事由
  successorCorporateNumber: 20, // 承継先法人番号
  successorCause: 21, // 承継等事由
  successorDate: 22, // 承継等年月日
  dummyFlag: 23, // ダミーフラグ（0/1）
  nameEn: 24, // 商号又は名称（英語）
  domPrefectureEn: 25, // 国内所在地（都道府県・英語）
  domAddressEn: 26, // 国内所在地（丁目番地等・英語）
  domAddressEnImageId: 27, // 国内所在地（英語）イメージID
  furigana: 28, // 商号又は名称（フリガナ）
  excludeFromSearch: 29, // 検索対象除外フラグ（0/1）
} as const;

/**
 * 日付を YYYY-MM-DD 形式にフォーマット
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * 日付を加算
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * JSTの昨日の日付を取得
 */
export function getYesterdayJST(): Date {
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
  jstTime.setDate(jstTime.getDate() - 1);
  return jstTime;
}

/**
 * CSVレコードをcorporationテーブルの型に変換
 */
export function parseCsvRecord(
  record: string[],
): typeof schema.corporation.$inferInsert {
  const getValue = (index: number) => {
    const val = record[index];
    return val === "" || val === undefined || val === null ? null : val;
  };

  const getDate = (index: number): string | null => {
    const val = getValue(index);
    if (!val) return null;
    if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return val;
    }
    if (val.length === 8 && /^\d{8}$/.test(val)) {
      return `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
    }
    return val;
  };

  const getInt = (index: number): number | null => {
    const val = getValue(index);
    if (!val) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  };

  const getBool = (index: number): boolean => {
    const val = getValue(index);
    return val === "1" || val === "true";
  };

  return {
    id: getInt(CSV_COLUMNS.sequenceNumber) ?? 0,
    corporateNumber: getValue(CSV_COLUMNS.corporateNumber) ?? "",
    processType: getValue(CSV_COLUMNS.processType) ?? "",
    correctionType: getValue(CSV_COLUMNS.correctionType) ?? "0",
    updatedDate: getDate(CSV_COLUMNS.updatedDate) ?? formatDate(new Date()),
    changedDate: getDate(CSV_COLUMNS.changedDate),
    name: getValue(CSV_COLUMNS.name),
    nameImageId: getValue(CSV_COLUMNS.nameImageId),
    corporationType: getValue(CSV_COLUMNS.corporationType),
    domPrefecture: getValue(CSV_COLUMNS.domPrefecture),
    domCity: getValue(CSV_COLUMNS.domCity),
    domAddress: getValue(CSV_COLUMNS.domAddress),
    domAddressImageId: getValue(CSV_COLUMNS.domAddressImageId),
    prefectureCode: getValue(CSV_COLUMNS.prefectureCode),
    cityCode: getValue(CSV_COLUMNS.cityCode),
    postalCode: getValue(CSV_COLUMNS.postalCode),
    foreignAddress: getValue(CSV_COLUMNS.foreignAddress),
    foreignAddressImageId: getValue(CSV_COLUMNS.foreignAddressImageId),
    closeDate: getDate(CSV_COLUMNS.closeDate),
    closeCause: getValue(CSV_COLUMNS.closeCause),
    successorCorporateNumber: getValue(CSV_COLUMNS.successorCorporateNumber),
    successorCause: getValue(CSV_COLUMNS.successorCause),
    successorDate: getDate(CSV_COLUMNS.successorDate),
    dummyFlag: getBool(CSV_COLUMNS.dummyFlag),
    nameEn: getValue(CSV_COLUMNS.nameEn),
    domPrefectureEn: getValue(CSV_COLUMNS.domPrefectureEn),
    domAddressEn: getValue(CSV_COLUMNS.domAddressEn),
    domAddressEnImageId: getValue(CSV_COLUMNS.domAddressEnImageId),
    furigana: getValue(CSV_COLUMNS.furigana),
    excludeFromSearch: getBool(CSV_COLUMNS.excludeFromSearch),
    updated_at: new Date(),
    created_at: new Date(),
  };
}

/**
 * 単一レコードのUPSERT実行
 * corporate_number のみで判定（1法人＝1最新レコードを維持）
 */
export async function upsertCorporation(
  record: typeof schema.corporation.$inferInsert,
): Promise<"inserted" | "updated"> {
  const existing = await db
    .select({ corporateNumber: corporation.corporateNumber })
    .from(corporation)
    .where(eq(corporation.corporateNumber, record.corporateNumber))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(corporation).values(record);
    return "inserted";
  } else {
    const { created_at, ...updateData } = record;
    await db
      .update(corporation)
      .set({ ...updateData, updated_at: new Date() })
      .where(eq(corporation.corporateNumber, record.corporateNumber));
    return "updated";
  }
}
