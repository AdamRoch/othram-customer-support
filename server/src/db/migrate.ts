import '../env.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';

const database = createDatabase();
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

try {
  await migrate(database.db, { migrationsFolder });
  console.info('Database migrations applied.');
} catch (error) {
  console.error('Database migration failed. Start Postgres with `docker compose up -d` and check DATABASE_URL.', error);
  process.exitCode = 1;
} finally {
  await database.close();
}
