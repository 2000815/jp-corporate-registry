import { defineEventHandler, getQuery, createError } from 'h3';
import { searchCorporations } from '../db/bigquery.js';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const name = query.name as string;

  if (!name) {
    throw createError({
      statusCode: 400,
      message: '検索する企業名（name）を指定してください。',
    });
  }

  try {
    const results = await searchCorporations(name, 100);

    const data = results.map(row => ({
      corporateNumber: row.corporateNumber,
      name: row.name,
      address: `${row.prefectureName || ''}${row.cityName || ''}${row.streetNumber || ''}`,
    }));

    return {
      count: data.length,
      data,
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: 'BigQueryへのクエリ実行中にエラーが発生しました。',
    });
  }
});
