import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

function createClient() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const url = new URL(databaseUrl)
  const socketPath = url.searchParams.get('host')

  const poolConfig = {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  }

  // Cloud SQL ソケット接続（Cloud Run）
  if (socketPath && socketPath.startsWith('/')) {
    return postgres({
      user: url.username,
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      host: socketPath,
      ...poolConfig,
    })
  }

  // 通常の TCP 接続（ローカル開発）
  return postgres(databaseUrl, poolConfig)
}

const client = createClient()
export const db = drizzle(client)
export const rawClient = client

export async function closeDb() {
  await rawClient.end()
}
