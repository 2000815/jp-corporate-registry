export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "国税庁法人情報検索API",
    description:
      "国税庁の法人情報をローカルDBに同期し、企業名で検索できるREST API",
    version: "1.0.0",
    license: {
      name: "ISC",
      url: "https://opensource.org/licenses/ISC",
    },
    contact: {
      name: "API Support",
      email: "",
    },
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3000}`,
      description: "開発環境",
    },
  ],
  paths: {
    "/search": {
      get: {
        summary: "企業名検索 (PostgreSQL)",
        description: "PostgreSQLから企業名で法人情報を部分一致検索します",
        tags: ["法人情報検索 - PostgreSQL"],
        parameters: [
          {
            name: "name",
            in: "query",
            description: "検索する企業名（部分一致）",
            required: true,
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 255,
              example: "株式会社テスト",
            },
          },
        ],
        responses: {
          "200": {
            description: "検索成功",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: {
                      type: "integer",
                      description: "検索結果の件数",
                      example: 2,
                    },
                    data: {
                      type: "array",
                      description: "法人情報の配列",
                      items: {
                        $ref: "#/components/schemas/Corporation",
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "リクエストエラー",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: {
                      type: "string",
                      description: "エラーメッセージ",
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "サーバーエラー",
          },
        },
      },
    },
    "/api/companies": {
      get: {
        summary: "法人検索API（トークン化AND検索）",
        description:
          "トークン化された検索クエリで法人情報をAND検索します。国税庁法人番号データを全量保持し、exclude_from_search=falseのレコードのみを検索対象とします。",
        tags: ["法人情報検索 - PostgreSQL"],
        parameters: [
          {
            name: "query",
            in: "query",
            description: "検索クエリ（スペース区切りでAND検索）",
            required: true,
            schema: {
              type: "string",
              minLength: 2,
              maxLength: 255,
              example: "東京 サンプル",
            },
          },
          {
            name: "limit",
            in: "query",
            description: "取得件数の上限（最大100）",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
              example: 5,
            },
          },
        ],
        responses: {
          "200": {
            description: "検索成功",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "検索クエリ",
                      example: "東京 サンプル",
                    },
                    limit: {
                      type: "integer",
                      description: "指定された取得件数上限",
                      example: 5,
                    },
                    count: {
                      type: "integer",
                      description: "検索結果の件数",
                      example: 2,
                    },
                    results: {
                      type: "array",
                      description: "法人情報の配列",
                      items: {
                        $ref: "#/components/schemas/CompanySearchResult",
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "リクエストエラー",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "500": {
            description: "サーバーエラー",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/search-bigquery": {
      get: {
        summary: "企業名検索 (BigQuery)",
        description: "BigQueryから企業名で法人情報を部分一致検索します",
        tags: ["法人情報検索 - BigQuery"],
        parameters: [
          {
            name: "name",
            in: "query",
            description: "検索する企業名（部分一致）",
            required: true,
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 255,
              example: "株式会社テスト",
            },
          },
        ],
        responses: {
          "200": {
            description: "検索成功",
          },
          "400": {
            description: "リクエストエラー",
          },
          "500": {
            description: "サーバーエラー",
          },
        },
      },
    },
    "/api/sync/diff": {
      post: {
        summary: "差分同期API",
        description:
          "国税庁から差分データを取得しDB全体を一括更新します。Cloud Schedulerからの呼び出しを想定。",
        tags: ["データ同期"],
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          description: "同期範囲（省略時はlast_processed_dateから昨日まで）",
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  fromDate: {
                    type: "string",
                    format: "date",
                    description: "取得開始日（YYYY-MM-DD）",
                    example: "2024-01-01",
                  },
                  toDate: {
                    type: "string",
                    format: "date",
                    description: "取得終了日（YYYY-MM-DD）",
                    example: "2024-01-31",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "同期成功",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string", example: "Sync completed" },
                    range: {
                      type: "object",
                      properties: {
                        from: { type: "string", example: "2024-01-01" },
                        to: { type: "string", example: "2024-01-31" },
                      },
                    },
                    stats: {
                      type: "object",
                      properties: {
                        processed: { type: "integer", example: 1000 },
                        inserted: { type: "integer", example: 500 },
                        updated: { type: "integer", example: 500 },
                      },
                    },
                    elapsedSeconds: { type: "number", example: 45.5 },
                  },
                },
              },
            },
          },
          "401": {
            description: "認証エラー",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                example: {
                  error: { code: "UNAUTHORIZED", message: "Invalid API key" },
                },
              },
            },
          },
          "500": {
            description: "サーバーエラー",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Corporation: {
        type: "object",
        description: "法人情報",
        properties: {
          corporateNumber: {
            type: "string",
            description: "法人番号（13桁）",
            pattern: "^[0-9]{13}$",
            example: "1010001000001",
          },
          name: {
            type: "string",
            description: "法人名",
            maxLength: 255,
            example: "株式会社テスト",
          },
          address: {
            type: "string",
            description: "住所",
            example: "東京都千代田区丸の内1-1-1",
          },
        },
        required: ["corporateNumber", "name", "address"],
      },
      CompanySearchResult: {
        type: "object",
        description: "法人検索結果",
        properties: {
          corporateNumber: {
            type: "string",
            description: "法人番号（13桁）",
            pattern: "^[0-9]{13}$",
            example: "1234567890123",
          },
          name: {
            type: "string",
            description: "法人名",
            example: "東京サンプル株式会社",
          },
          nameEn: {
            type: "string",
            description: "法人名（英語）",
            nullable: true,
            example: "Tokyo Sample Co., Ltd.",
          },
          prefecture: {
            type: "string",
            description: "都道府県",
            example: "東京都",
          },
          city: {
            type: "string",
            description: "市区町村",
            example: "千代田区",
          },
          address: {
            type: "string",
            description: "丁目番地等",
            example: "丸の内1-1-1",
          },
          updatedDate: {
            type: "string",
            format: "date",
            description: "更新年月日",
            example: "2024-01-10",
          },
        },
        required: [
          "corporateNumber",
          "name",
          "prefecture",
          "city",
          "address",
          "updatedDate",
        ],
      },
      ErrorResponse: {
        type: "object",
        description: "エラーレスポンス",
        properties: {
          error: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "エラーコード",
                example: "MISSING_QUERY",
              },
              message: {
                type: "string",
                description: "エラーメッセージ",
                example: "検索クエリ（query）を指定してください。",
              },
              details: {
                type: "object",
                description: "追加の詳細情報",
              },
            },
            required: ["code", "message"],
          },
        },
        required: ["error"],
      },
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  tags: [
    {
      name: "法人情報検索 - PostgreSQL",
      description: "PostgreSQLを使用した法人情報検索API",
    },
    {
      name: "法人情報検索 - BigQuery",
      description: "BigQueryを使用した法人情報検索API（大規模データ対応）",
    },
    {
      name: "データ同期",
      description: "国税庁データとの差分同期API",
    },
  ],
};
