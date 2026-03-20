import { defineEventHandler, getQuery, createError } from 'h3';
import { db, schema } from '../db/index.js';
import { like, and, sql, asc } from 'drizzle-orm';

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

  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const tokens = trimmed.split(/[\s\t]+/u);
  return tokens.filter(token => token.length >= 2);
}

/**
 * 法人検索API
 * GET /api/companies
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const searchQuery = query.query as string;
  const limitParam = query.limit as string;

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

  let limit = 20;
  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, 100);
    }
  }

  try {
    const tokenConditions = tokens.map(token =>
      like(corporation.name, `%${token}%`)
    );

    const whereConditions = and(
      sql`${corporation.excludeFromSearch} = false`,
      ...tokenConditions
    );

    const results = await db
      .select({
        corporateNumber: corporation.corporateNumber,
        name: corporation.name,
        nameEn: corporation.nameEn,
        domPrefecture: corporation.domPrefecture,
        domCity: corporation.domCity,
        domAddress: corporation.domAddress,
        updatedDate: corporation.updatedDate,
      })
      .from(corporation)
      .where(whereConditions)
      .orderBy(asc(sql`lower(${corporation.name})`), asc(corporation.corporateNumber))
      .limit(limit);

    const formattedResults = results.map(row => ({
      corporateNumber: row.corporateNumber,
      name: row.name,
      nameEn: row.nameEn,
      prefecture: row.domPrefecture,
      city: row.domCity,
      address: row.domAddress,
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
