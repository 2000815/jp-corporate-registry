import { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';

/**
 * BigQueryクライアントの初期化
 */
const bigqueryOptions: BigQueryOptions = {
  projectId: process.env.BIGQUERY_PROJECT_ID,
};

// Cloud Run 等ではサービスアカウントに権限を付与するだけでよい
if (process.env.BIGQUERY_KEY_FILE) {
  bigqueryOptions.keyFilename = process.env.BIGQUERY_KEY_FILE;
}

export const bigquery = new BigQuery(bigqueryOptions);

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
