import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkZendeskTicket } from '../scripts/vendor-smoke.js';

const originalEnvironment = {
  subdomain: process.env.ZENDESK_SUBDOMAIN,
  clientId: process.env.ZENDESK_CLIENT_ID,
  clientSecret: process.env.ZENDESK_CLIENT_SECRET
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of [
    ['ZENDESK_SUBDOMAIN', originalEnvironment.subdomain],
    ['ZENDESK_CLIENT_ID', originalEnvironment.clientId],
    ['ZENDESK_CLIENT_SECRET', originalEnvironment.clientSecret]
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Zendesk vendor smoke boundary', () => {
  it('stops after a 403 identity read and never creates a ticket', async () => {
    process.env.ZENDESK_SUBDOMAIN = 'example';
    process.env.ZENDESK_CLIENT_ID = 'client-id';
    process.env.ZENDESK_CLIENT_SECRET = 'client-secret';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'test-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 403));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkZendeskTicket()).rejects.toThrow(
      'Zendesk identity read returned HTTP 403'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['https://example.zendesk.com/oauth/tokens', 'POST'],
      ['https://example.zendesk.com/api/v2/users/me.json', 'GET']
    ]);
  });

  it('performs one identity read, one ticket create, and one matching ticket read', async () => {
    process.env.ZENDESK_SUBDOMAIN = 'example';
    process.env.ZENDESK_CLIENT_ID = 'client-id';
    process.env.ZENDESK_CLIENT_SECRET = 'client-secret';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'test-token' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ ticket: { id: 42 } }))
      .mockResolvedValueOnce(jsonResponse({ ticket: { id: 42 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkZendeskTicket()).resolves.toMatchObject({
      name: 'Zendesk authenticated ticket'
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['https://example.zendesk.com/oauth/tokens', 'POST'],
      ['https://example.zendesk.com/api/v2/users/me.json', 'GET'],
      ['https://example.zendesk.com/api/v2/tickets.json', 'POST'],
      ['https://example.zendesk.com/api/v2/tickets/42.json', 'GET']
    ]);
  });
});
