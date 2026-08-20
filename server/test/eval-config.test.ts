import { describe, expect, it } from 'vitest';
import { requireEvalDatabaseUrl } from '../src/eval/config.js';

describe('eval database configuration', () => {
  it('requires an explicit dedicated eval database URL', () => {
    expect(() => requireEvalDatabaseUrl('')).toThrow('EVAL_DATABASE_URL is required');
    expect(() => requireEvalDatabaseUrl('postgresql://othram:othram@127.0.0.1:5432/othram'))
      .toThrow('database containing "eval"');
  });

  it('rejects malformed and non-PostgreSQL URLs without exposing credentials', () => {
    expect(() => requireEvalDatabaseUrl('not a url')).toThrow('valid PostgreSQL connection URL');
    expect(() => requireEvalDatabaseUrl('mysql://user:secret@localhost/othram_eval'))
      .toThrow('postgres or postgresql protocol');
  });

  it('accepts a PostgreSQL database whose name identifies it as eval-only', () => {
    const url = 'postgresql://othram:othram@127.0.0.1:5432/othram_eval';
    expect(requireEvalDatabaseUrl(url)).toBe(url);
  });
});
