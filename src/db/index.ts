import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

function createClient() {
  const databaseUrl = process.env.DATABASE_URL!;
  const url = new URL(databaseUrl);
  const socketPath = url.searchParams.get('host');

  // Cloud SQL ソケット接続（Cloud Run）
  if (socketPath && socketPath.startsWith('/')) {
    return postgres({
      user: url.username,
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      host: socketPath,
    });
  }

  // 通常の TCP 接続（ローカル開発）
  return postgres(databaseUrl);
}

const client = createClient();
export const db = drizzle(client, { schema });
export { schema };
