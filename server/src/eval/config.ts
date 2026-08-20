/**
 * The dedicated database is the outer boundary around eval durable work and
 * reference configuration. The CLI owns this guard; test callers inject their
 * isolated database directly into the library.
 */
export function requireEvalDatabaseUrl(value = process.env.EVAL_DATABASE_URL): string {
  if (!value?.trim()) {
    throw new Error('EVAL_DATABASE_URL is required. Point it at a dedicated database whose name contains "eval".');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EVAL_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('EVAL_DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const databaseName = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
  if (!databaseName || !databaseName.toLowerCase().includes('eval')) {
    throw new Error('EVAL_DATABASE_URL must name a dedicated database containing "eval".');
  }
  return value;
}
