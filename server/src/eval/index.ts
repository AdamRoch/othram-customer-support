import '../env.js';
import { createDatabase } from '../db/client.js';
import { requireEvalDatabaseUrl } from './config.js';
import { formatLocalTicketEval, runLocalTicketEval } from './local-ticket-eval.js';

let database: ReturnType<typeof createDatabase> | undefined;
try {
  database = createDatabase(requireEvalDatabaseUrl());
  await database.checkConnection();
  console.info(formatLocalTicketEval(await runLocalTicketEval({ database: database.db })));
} catch (error) {
  console.error('Local ticket evaluation failed.', error);
  process.exitCode = 1;
} finally {
  await database?.close();
}
