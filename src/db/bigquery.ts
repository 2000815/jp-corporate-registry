import { BigQuery } from '@google-cloud/bigquery';

/**
 * BigQueryクライアントの初期化
 */
export const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID,
  keyFilename: process.env.BIGQUERY_KEY_FILE,
});

/**
 * 企業情報の型定義
 */
export interface Corporation {
  corporateNumber: string;
  name: string;
  prefectureName: string | null;
  cityName: string | null;
  streetNumber: string | null;
}

/**
 * 企業名で検索
 */
export async function searchCorporations(name: string, limit = 100): Promise<Corporation[]> {
  const datasetId = process.env.BIGQUERY_DATASET_ID || 'corporations';
  const tableId = process.env.BIGQUERY_TABLE_ID || 'corporations';

  const query = `
    SELECT 
      corporateNumber,
      name,
      prefectureName,
      cityName,
      streetNumber
    FROM \`${process.env.BIGQUERY_PROJECT_ID}.${datasetId}.${tableId}\`
    WHERE name LIKE @name
    ORDER BY name
    LIMIT @limit
  `;

  const options = {
    query,
    params: {
      name: `%${name}%`,
      limit,
    },
  };

  const [rows] = await bigquery.query(options);
  return rows as Corporation[];
}
