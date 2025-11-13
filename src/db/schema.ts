import { pgTable, serial, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * 法人情報テーブルのスキーマ定義
 */
export const corporations = pgTable(
  'corporations',
  {
    id: serial('id').primaryKey(),
    corporateNumber: varchar('corporate_number', { length: 13 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    prefectureName: varchar('prefecture_name', { length: 50 }),
    cityName: varchar('city_name', { length: 100 }),
    streetNumber: varchar('street_number', { length: 255 }),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // 企業名での高速検索用インデックス
    nameIdx: index('idx_corporations_name').on(table.name),
    // 法人番号での検索用インデックス
    corporateNumberIdx: index('idx_corporations_corporate_number').on(table.corporateNumber),
  })
);

/**
 * corporationsテーブルの型定義
 */
export type Corporation = typeof corporations.$inferSelect;
export type NewCorporation = typeof corporations.$inferInsert;
