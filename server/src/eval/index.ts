import '../env.js';
import { createDatabase } from '../db/client.js';
import { formatLocalTicketEval, runLocalTicketEval } from './local-ticket-eval.js';

const database = createDatabase();
try {
  await database.checkConnection();
  console.info(formatLocalTicketEval(await runLocalTicketEval({ database: database.db })));
} catch (error) {
  console.error('Local ticket evaluation failed.', error);
  process.exitCode = 1;
} finally {
  await database.close();
}
