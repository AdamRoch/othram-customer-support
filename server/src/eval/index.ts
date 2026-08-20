import '../env.js';
import { createDatabase } from '../db/client.js';
import { requireEvalDatabaseUrl } from './config.js';
import { formatLocalTicketEval, runDeterministicLocalTicketEval } from './local-ticket-eval.js';

let database: ReturnType<typeof createDatabase> | undefined;
try {
  database = createDatabase(requireEvalDatabaseUrl());
  await database.checkConnection();
  const result = await runDeterministicLocalTicketEval({ database: database.db });
  console.info([
    formatLocalTicketEval(result.scoreboard),
    `Determinism: PASS (${result.runCount} identical runs)`
  ].join('\n'));
} catch (error) {
  console.error('Local ticket evaluation failed.', error);
  process.exitCode = 1;
} finally {
  await database?.close();
}
