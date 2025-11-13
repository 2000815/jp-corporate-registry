export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: '国税庁法人情報検索API',
    description: '国税庁の法人情報をローカルDBに同期し、企業名で検索できるREST API',
    version: '1.0.0',
    license: {
      name: 'ISC',
      url: 'https://opensource.org/licenses/ISC'
    },
    contact: {
      name: 'API Support',
      email: ''
    }
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3000}`,
      description: '開発環境'
    }
  ],
  paths: {
    '/search': {
      get: {
        summary: '企業名検索 (PostgreSQL)',
        description: 'PostgreSQLから企業名で法人情報を部分一致検索します',
        tags: ['法人情報検索 - PostgreSQL'],
        parameters: [
          {
            name: 'name',
            in: 'query',
            description: '検索する企業名（部分一致）',
            required: true,
            schema: {
              type: 'string',
              minLength: 1,
              maxLength: 255,
              example: '株式会社テスト'
            }
          }
        ],
        responses: {
          '200': {
            description: '検索成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: {
                      type: 'integer',
                      description: '検索結果の件数',
                      example: 2
                    },
                    data: {
                      type: 'array',
                      description: '法人情報の配列',
                      items: {
                        $ref: '#/components/schemas/Corporation'
                      }
                    }
                  }
                },
                examples: {
                  '成功例': {
                    summary: '検索結果あり',
                    value: {
                      count: 2,
                      data: [
                        {
                          corporateNumber: '1010001000001',
                          name: '株式会社テスト',
                          address: '東京都千代田区丸の内1-1-1'
                        },
                        {
                          corporateNumber: '1010001000002',
                          name: 'テスト工業株式会社',
                          address: '東京都新宿区西新宿2-8-1'
                        }
                      ]
                    }
                  },
                  '結果なし': {
                    summary: '検索結果なし',
                    value: {
                      count: 0,
                      data: []
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'リクエストエラー',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      description: 'エラーメッセージ',
                      example: '検索する企業名（name）を指定してください。'
                    }
                  }
                }
              }
            }
          },
          '500': {
            description: 'サーバーエラー',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      description: 'エラーメッセージ',
                      example: '内部サーバーエラーが発生しました。'
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/search-bigquery': {
      get: {
        summary: '企業名検索 (BigQuery)',
        description: 'BigQueryから企業名で法人情報を部分一致検索します。大規模データに対応。',
        tags: ['法人情報検索 - BigQuery'],
        parameters: [
          {
            name: 'name',
            in: 'query',
            description: '検索する企業名（部分一致）',
            required: true,
            schema: {
              type: 'string',
              minLength: 1,
              maxLength: 255,
              example: '株式会社テスト'
            }
          }
        ],
        responses: {
          '200': {
            description: '検索成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: {
                      type: 'integer',
                      description: '検索結果の件数',
                      example: 2
                    },
                    data: {
                      type: 'array',
                      description: '法人情報の配列',
                      items: {
                        $ref: '#/components/schemas/Corporation'
                      }
                    }
                  }
                },
                examples: {
                  '成功例': {
                    summary: '検索結果あり',
                    value: {
                      count: 2,
                      data: [
                        {
                          corporateNumber: '1010001000001',
                          name: '株式会社テスト',
                          address: '東京都千代田区丸の内1-1-1'
                        },
                        {
                          corporateNumber: '1010001000002',
                          name: 'テスト工業株式会社',
                          address: '東京都新宿区西新宿2-8-1'
                        }
                      ]
                    }
                  },
                  '結果なし': {
                    summary: '検索結果なし',
                    value: {
                      count: 0,
                      data: []
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'リクエストエラー',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      description: 'エラーメッセージ',
                      example: '検索する企業名（name）を指定してください。'
                    }
                  }
                }
              }
            }
          },
          '500': {
            description: 'サーバーエラー',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      description: 'エラーメッセージ',
                      example: 'BigQueryへのクエリ実行中にエラーが発生しました。'
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      Corporation: {
        type: 'object',
        description: '法人情報',
        properties: {
          corporateNumber: {
            type: 'string',
            description: '法人番号（13桁）',
            pattern: '^[0-9]{13}$',
            example: '1010001000001'
          },
          name: {
            type: 'string',
            description: '法人名',
            maxLength: 255,
            example: '株式会社テスト'
          },
          address: {
            type: 'string',
            description: '住所（都道府県名 + 市区町村名 + 丁目番地等）',
            example: '東京都千代田区丸の内1-1-1'
          }
        },
        required: ['corporateNumber', 'name', 'address'],
        xml: {
          name: 'corporation'
        }
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'エラーメッセージ'
          }
        },
        required: ['error']
      }
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      }
    }
  },
  tags: [
    {
      name: '法人情報検索 - PostgreSQL',
      description: 'PostgreSQLを使用した法人情報検索API'
    },
    {
      name: '法人情報検索 - BigQuery',
      description: 'BigQueryを使用した法人情報検索API（大規模データ対応）'
    }
  ]
};
