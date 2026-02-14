import { defineEventHandler, getQuery, createError } from 'h3';
import { db, schema } from '../db/index.js';
import { like, and, sql, desc, asc } from 'drizzle-orm';

const { corporation } = schema;

/**
 * 検索クエリをトークン化する
 * - 前後の空白をトリム
 * - 全角・半角スペース、タブで分割
 * - 空文字および1文字以下のトークンは除外
 */
function tokenizeQuery(query: string): string[] {
  if (!query || typeof query !== 'string') {
    return [];
  }

  // 前後の空白をトリム
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  // 全角・半角スペース、タブで分割
  const tokens = trimmed.split(/[\s\t]+/u);

  // 空文字および1文字以下のトークンを除外
  return tokens.filter(token => token.length >= 2);
}

/**
 * 法人検索API
 * GET /api/companies
 * 
 * 仕様:
 * - クエリパラメータ: query (必須), limit (任意, デフォルト20, 最大100)
 * - トークン化してAND検索
 * - exclude_from_search = false のレコードのみ対象
 * - 部分一致 (LIKE '%token%')
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const searchQuery = query.query as string;
  const limitParam = query.limit as string;

  // 検証: queryパラメータ必須
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: {
          code: 'MISSING_QUERY',
          message: '検索クエリ（query）を指定してください。',
          details: {},
        },
      },
    });
  }

  // トークン化
  const tokens = tokenizeQuery(searchQuery);

  if (tokens.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: {
          code: 'INVALID_QUERY',
          message: '検索クエリに有効なトークン（2文字以上）が含まれていません。',
          details: {},
        },
      },
    });
  }

  // limitのパースと検証
  let limit = 20;
  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, 100); // 最大100件
    }
  }

  try {
    // 検索条件の構築
    // 各トークンに対して name LIKE '%token%' を生成
    const tokenConditions = tokens.map(token => 
      like(corporation.name, `%${token}%`)
    );

    // AND条件: exclude_from_search = false AND (token1 AND token2 AND ...)
    const whereConditions = and(
      sql`${corporation.excludeFromSearch} = false`,
      ...tokenConditions
    );

    // 検索実行
    const results = await db
      .select({
        corporateNumber: corporation.corporateNumber,
        name: corporation.name,
        nameEn: corporation.nameEn,
        prefectureName: corporation.prefectureName,
        cityName: corporation.cityName,
        streetNumber: corporation.streetNumber,
        updatedDate: corporation.updatedDate,
      })
      .from(corporation)
      .where(whereConditions)
      .orderBy(asc(sql`lower(${corporation.name})`), asc(corporation.corporateNumber))
      .limit(limit);

    // レスポンス形式の変換
    const formattedResults = results.map(row => ({
      corporateNumber: row.corporateNumber,
      name: row.name,
      nameEn: row.nameEn,
      prefecture: row.prefectureName,
      city: row.cityName,
      address: row.streetNumber,
      updatedDate: row.updatedDate,
    }));

    return {
      query: searchQuery,
      limit,
      count: formattedResults.length,
      results: formattedResults,
    };

  } catch (error) {
    console.error('検索エラー:', error);
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: {
        error: {
          code: 'SEARCH_ERROR',
          message: '検索処理中にエラーが発生しました。',
          details: {},
        },
      },
    });
  }
});
