import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const defaultDatabaseUrl = 'postgresql://othram:othram@127.0.0.1:5432/othram';

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? defaultDatabaseUrl;
}

export function createDatabase(databaseUrl = getDatabaseUrl()) {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    db: drizzle(pool),
    checkConnection: async () => {
      await pool.query('SELECT 1');
    },
    close: async () => {
      await pool.end();
    }
  };
}
