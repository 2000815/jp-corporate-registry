import { defineEventHandler, getQuery, createError } from 'h3';
import { db, schema } from '../db/index.js';
import { like } from 'drizzle-orm';

const { corporations } = schema;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const name = query.name as string;

  if (!name) {
    throw createError({
      statusCode: 400,
      message: '検索する企業名（name）を指定してください。',
    });
  }

  const results = await db
    .select({
      corporateNumber: corporations.corporateNumber,
      name: corporations.name,
      prefectureName: corporations.prefectureName,
      cityName: corporations.cityName,
      streetNumber: corporations.streetNumber,
    })
    .from(corporations)
    .where(like(corporations.name, `%${name}%`))
    .orderBy(corporations.name)
    .limit(100);

  const data = results.map(row => ({
    corporateNumber: row.corporateNumber,
    name: row.name,
    address: `${row.prefectureName || ''}${row.cityName || ''}${row.streetNumber || ''}`,
  }));

  return {
    count: data.length,
    data,
  };
});
