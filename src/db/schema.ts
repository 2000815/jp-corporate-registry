import {
  pgTable,
  serial,
  varchar,
  char,
  date,
  timestamp,
  boolean,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * 法人情報テーブルのスキーマ定義
 * 国税庁法人番号データを全て保持（1法人=1最新レコード）
 */
export const corporation = pgTable(
  "corporation",
  {
    // 1. 一連番号
    id: integer("id").notNull(),
    // 2. 法人番号 (13桁) - 主キー
    corporateNumber: char("corporate_number", { length: 13 }).notNull(),
    // 3. 処理区分 (01:新規, 11:商号変更, etc.)
    processType: char("process_type", { length: 2 }).notNull(),
    // 4. 訂正区分 (0:訂正なし, 1:訂正あり)
    correctionType: char("correction_type", { length: 1 })
      .notNull()
      .default("0"),
    // 5. 更新年月日
    updatedDate: date("updated_date").notNull(),
    // 6. 変更年月日
    changedDate: date("changed_date"),
    // 7. 商号又は名称
    name: varchar("name", { length: 300 }),
    // 8. 商号又は名称イメージID (外字等がある場合)
    nameImageId: varchar("name_image_id", { length: 8 }),
    // 9. 法人種別 (101:国の機関, 201:株式会社, etc.)
    corporationType: varchar("corporation_type", { length: 3 }),
    // 10. 国内所在地（都道府県）
    prefectureName: varchar("prefecture_name", { length: 50 }),
    // 11. 国内所在地（市区町村）
    cityName: varchar("city_name", { length: 100 }),
    // 12. 国内所在地（丁目番地等）
    streetNumber: varchar("street_number", { length: 300 }),
    // 13. 国内所在地イメージID
    addressImageId: varchar("address_image_id", { length: 8 }),
    // 14. 都道府県コード (JIS X 0401)
    prefectureCode: char("prefecture_code", { length: 2 }),
    // 15. 市区町村コード (JIS X 0402)
    cityCode: char("city_code", { length: 5 }),
    // 16. 郵便番号
    postalCode: char("postal_code", { length: 7 }),
    // 17. 国外所在地
    foreignAddress: varchar("foreign_address", { length: 300 }),
    // 18. 国外所在地イメージID
    foreignAddressImageId: varchar("foreign_address_image_id", { length: 8 }),
    // 19. 登記記録の閉鎖等年月日
    closeDate: date("close_date"),
    // 20. 登記記録の閉鎖等の事由 (01:清算の結了, 11:合併による解散, etc.)
    closeCause: char("close_cause", { length: 2 }),
    // 21. 承継先法人番号
    successorCorporateNumber: char("successor_corporate_number", {
      length: 13,
    }),
    // 22. 承継等事由 (吸収合併など自由記述あり)
    successorCause: varchar("successor_cause", { length: 200 }),
    // 23. 承継等年月日
    successorDate: date("successor_date"),
    // 24. ダミーフラグ (0/1)
    dummyFlag: boolean("dummy_flag").notNull().default(false),
    // 25. 商号又は名称（英語）
    nameEn: varchar("name_en", { length: 300 }),
    // 26. 国内所在地（都道府県・英語）
    prefectureNameEn: varchar("prefecture_name_en", { length: 100 }),
    // 27. 国内所在地（丁目番地等・英語）
    streetNumberEn: varchar("street_number_en", { length: 300 }),
    // 28. 国内所在地（英語）イメージID
    addressEnImageId: varchar("address_en_image_id", { length: 8 }),
    // 29. 商号又は名称（フリガナ）
    furigana: varchar("furigana", { length: 500 }),
    // 30. 検索対象除外 (CSV値: 0 or 1)
    excludeFromSearch: boolean("exclude_from_search").notNull().default(false),
    // システム管理用
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({
        columns: [table.corporateNumber],
        name: "corporation_pkey",
      }),
      // 基本検索インデックス
      nameIdx: index("corporation_name_idx").on(table.name),
      // pg_trgmによる高速部分一致検索（GINインデックス）
      nameTrgmIdx: index("corporation_name_trgm_idx")
        .using("gin", sql`${table.name} gin_trgm_ops`)
        .where(sql`${table.excludeFromSearch} = false`),
      // 大文字小文字無視検索用
      nameLowerIdx: index("corporation_name_lower_idx")
        .on(sql`lower(${table.name})`)
        .where(sql`${table.excludeFromSearch} = false`),
      // 検索順序最適化インデックス
      searchOrderIdx: index("corporation_search_order_idx")
        .on(sql`lower(${table.name})`, table.corporateNumber)
        .where(sql`${table.excludeFromSearch} = false`),
      // 法人番号検索用
      corporateNumberIdx: index("corporation_corporate_number_idx").on(
        table.corporateNumber,
      ),
      // 更新日時検索用
      updatedDateIdx: index("corporation_updated_date_idx").on(
        table.updatedDate,
      ),
    };
  },
);

/**
 * インポート状態管理テーブル
 * 最終処理日（last_processed_date）のみを管理
 */
export const importState = pgTable("import_state", {
  id: serial("id").primaryKey(),
  // 最終処理日（YYYY-MM-DD形式）
  lastProcessedDate: date("last_processed_date").notNull(),
  // 更新日時
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // 作成日時
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * インポート実行履歴テーブル（監視・追跡用）
 */
export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  // 実行開始時刻
  startedAt: timestamp("started_at").notNull().defaultNow(),
  // 実行終了時刻
  completedAt: timestamp("completed_at"),
  // 対象期間（from）
  fromDate: date("from_date").notNull(),
  // 対象期間（to）
  toDate: date("to_date").notNull(),
  // 処理件数
  processedCount: integer("processed_count").default(0),
  // 挿入件数
  insertedCount: integer("inserted_count").default(0),
  // 更新件数
  updatedCount: integer("updated_count").default(0),
  // 成否
  success: boolean("success").notNull().default(false),
  // エラーメッセージ
  errorMessage: varchar("error_message", { length: 1000 }),
  // 更新日時
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 型定義のエクスポート
export type Corporation = typeof corporation.$inferSelect;
export type NewCorporation = typeof corporation.$inferInsert;
export type ImportState = typeof importState.$inferSelect;
export type NewImportState = typeof importState.$inferInsert;
export type ImportRuns = typeof importRuns.$inferSelect;
export type NewImportRuns = typeof importRuns.$inferInsert;

// 後方互換性のため（古いコード用）
export const corporations = corporation;
export type CorporationLegacy = typeof corporations.$inferSelect;
export type NewCorporationLegacy = typeof corporations.$inferInsert;
