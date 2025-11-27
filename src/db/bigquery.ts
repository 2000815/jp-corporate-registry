import { BigQuery, BigQueryOptions } from "@google-cloud/bigquery";

// 必須環境変数のチェック
const requiredEnvVars = ["BIGQUERY_PROJECT_ID"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: ${envVar} is not set.`);
  }
}

// 設定オブジェクト
const config = {
  projectId: process.env.BIGQUERY_PROJECT_ID || "",
  datasetId: process.env.BIGQUERY_DATASET_ID || "corporations",
  tableId: process.env.BIGQUERY_TABLE_ID || "corporations",
  location: process.env.BIGQUERY_LOCATION || "asia-northeast1",
};

// BigQueryクライアントの初期化
const bigqueryOptions: BigQueryOptions = {
  projectId: config.projectId,
  location: config.location,
};

// ローカル開発環境でのみキーファイルを使用
if (process.env.NODE_ENV !== "production" && process.env.BIGQUERY_KEY_FILE) {
  bigqueryOptions.keyFilename = process.env.BIGQUERY_KEY_FILE;
  console.log("Using key file for BigQuery authentication");
} else if (process.env.NODE_ENV === "production") {
  console.log("Using Application Default Credentials for BigQuery");
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
 * @param name 検索する企業名
 * @param limit 取得件数の上限（デフォルト: 100件）
 * @returns 企業情報の配列
 * @throws クエリ実行エラー時にスロー
 */
export async function searchCorporations(
  name: string,
  limit = 100
): Promise<Corporation[]> {
  try {
    if (!name || typeof name !== "string") {
      throw new Error("検索名が無効です");
    }

    console.log(`Searching for corporations with name: ${name}`);

    const query = `
      SELECT
        corporateNumber,
        name,
        prefectureName,
        cityName,
        streetNumber
      FROM \`${config.projectId}.${config.datasetId}.${config.tableId}\`
      WHERE name LIKE @name
      ORDER BY name
      LIMIT @limit
    `;

    const [rows] = await bigquery.query({
      query,
      params: {
        name: `%${name}%`,
        limit,
      },
      location: config.location,
    });

    console.log(`Found ${rows.length} corporations`);
    return rows as Corporation[];
  } catch (error) {
    console.error("企業検索中にエラーが発生しました:", error);
    throw new Error(
      `企業情報の取得に失敗しました: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
