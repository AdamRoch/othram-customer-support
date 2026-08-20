/**
 * Throwaway vendor spike for OTHRM-10. This is deliberately not production
 * integration code: it exercises the riskiest provider assumptions before
 * channel adapters are built.
 *
 * It emits only sanitized pass/fail summaries. Never add response logging,
 * credentials, tokens, or generated audio persistence here.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  AudioFormat,
  ElevenLabsClient,
  RealtimeEvents,
} from '@elevenlabs/elevenlabs-js';
import OpenAI from 'openai';

const execFile = promisify(execFileCallback);
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const smokeModel = process.env.OPENAI_SMOKE_MODEL ?? 'gpt-4.1-mini';

type CheckResult = { name: string; detail: string };
type NamedCheck = { name: string; run: () => Promise<CheckResult> };

class SmokeFailure extends Error {
  constructor(readonly summary: string) {
    super(summary);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function safeFailure(error: unknown): string {
  // Provider error bodies may echo request context. Keep console output safe.
  if (error instanceof SmokeFailure || (error instanceof Error && error.message.startsWith('Missing required'))) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') {
    return `provider returned HTTP ${error.statusCode}`;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return `provider returned HTTP ${error.status}`;
  }
  return `provider request did not complete (${error instanceof Error ? error.name : 'unknown error'})`;
}

function wavData(wav: Buffer): Buffer {
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF' || wav.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new SmokeFailure('generated Scribe input was not a WAVE file');
  }

  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString('ascii');
    const length = wav.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === 'data') {
      return wav.subarray(dataStart, dataStart + length);
    }
    offset = dataStart + length + (length % 2);
  }

  throw new SmokeFailure('generated Scribe input did not contain PCM data');
}

async function readAudioStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function checkOpenAiToolCalling(): Promise<CheckResult> {
  const client = new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY') });
  const tools = [{
    type: 'function' as const,
    name: 'lookup_smoke_status',
    description: 'Returns the status of a vendor smoke test.',
    parameters: {
      type: 'object',
      properties: { check: { type: 'string' } },
      required: ['check'],
      additionalProperties: false,
    },
    strict: true,
  }];
  const firstResponse = await client.responses.create({
    model: smokeModel,
    input: 'Call lookup_smoke_status for the OpenAI check. Do not answer before calling it.',
    tools,
  });
  const toolCall = firstResponse.output.find((item) => item.type === 'function_call');
  if (!toolCall || toolCall.type !== 'function_call') {
    throw new SmokeFailure('model did not return a function call');
  }

  const finalResponse = await client.responses.create({
    model: smokeModel,
    previous_response_id: firstResponse.id,
    input: [{
      type: 'function_call_output',
      call_id: toolCall.call_id,
      output: JSON.stringify({ status: 'pass' }),
    }],
    tools,
  });
  if (!finalResponse.output_text.trim()) {
    throw new SmokeFailure('model did not complete the tool result round trip');
  }

  return { name: 'OpenAI tool calling', detail: 'toy tool call returned and its result completed a second model turn' };
}

async function checkScribeRealtime(directory: string): Promise<CheckResult> {
  const wavPath = join(directory, 'scribe-input.wav');
  await execFile('say', [
    '--file-format=WAVE',
    '--data-format=LEI16@16000',
    '-o',
    wavPath,
    'Othram realtime transcription vendor smoke test.',
  ]);
  const pcm = wavData(await readFile(wavPath));
  if (pcm.length === 0) throw new SmokeFailure('generated Scribe input was empty');

  const client = new ElevenLabsClient({ apiKey: requiredEnv('ELEVENLABS_API_KEY') });
  const connection = await client.speechToText.realtime.connect({
    modelId: 'scribe_v2_realtime',
    audioFormat: AudioFormat.PCM_16000,
    sampleRate: 16_000,
    languageCode: 'en',
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new SmokeFailure('timed out opening the Scribe realtime session')), 15_000);
      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        clearTimeout(timeout);
        resolve();
      });
      connection.on(RealtimeEvents.ERROR, () => {
        clearTimeout(timeout);
        reject(new SmokeFailure('Scribe realtime rejected the session'));
      });
    });

    const committed = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new SmokeFailure('timed out waiting for a committed transcript')), 15_000);
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
        clearTimeout(timeout);
        resolve(text);
      });
      connection.on(RealtimeEvents.ERROR, () => {
        clearTimeout(timeout);
        reject(new SmokeFailure('Scribe realtime returned an error event'));
      });

      void (async () => {
        for (let offset = 0; offset < pcm.length; offset += 4_096) {
          connection.send({ audioBase64: pcm.subarray(offset, offset + 4_096).toString('base64') });
          await wait(20);
        }
        connection.commit();
      })().catch(reject);
    });
    if (!committed.trim()) throw new Error('Scribe committed an empty transcript');
  } finally {
    connection.close();
  }

  return { name: 'ElevenLabs Scribe realtime', detail: 'Node WebSocket accepted streamed generated PCM and committed a nonempty transcript' };
}

async function checkV3AudioTags(directory: string): Promise<CheckResult> {
  if (process.env.SMOKE_PLAY_AUDIO !== '1') {
    throw new SmokeFailure('set SMOKE_PLAY_AUDIO=1 to require the audible tag comparison');
  }

  const client = new ElevenLabsClient({ apiKey: requiredEnv('ELEVENLABS_API_KEY') });
  const voiceId = requiredEnv('ELEVENLABS_VOICE_ID');
  const phrase = 'The support team is here to help you.';
  const render = async (text: string) => readAudioStream(await client.textToSpeech.convert(voiceId, {
    modelId: 'eleven_v3',
    outputFormat: 'mp3_44100_128',
    text,
  }));

  const [calm, chuckles] = await Promise.all([
    render(`[calm] ${phrase}`),
    render(`[chuckles] ${phrase}`),
  ]);
  if (calm.length === 0 || chuckles.length === 0 || calm.equals(chuckles)) {
    throw new SmokeFailure('v3 tag renders were missing or identical');
  }

  const calmPath = join(directory, 'calm.mp3');
  const chucklesPath = join(directory, 'chuckles.mp3');
  await Promise.all([writeFile(calmPath, calm), writeFile(chucklesPath, chuckles)]);
  await execFile('afplay', [calmPath]);
  await execFile('afplay', [chucklesPath]);

  return { name: 'ElevenLabs v3 audio tags', detail: '[calm] and [chuckles] produced distinct audio and both clips completed local audible playback' };
}

async function zendeskAccessToken(): Promise<string> {
  const subdomain = requiredEnv('ZENDESK_SUBDOMAIN');
  const body = JSON.stringify({
    grant_type: 'client_credentials',
    client_id: requiredEnv('ZENDESK_CLIENT_ID'),
    client_secret: requiredEnv('ZENDESK_CLIENT_SECRET'),
    expires_in: 600,
  });
  const response = await fetch(`https://${subdomain}.zendesk.com/oauth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!response.ok) throw new SmokeFailure(`Zendesk token endpoint returned HTTP ${response.status}`);
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new SmokeFailure('Zendesk token response was incomplete');
  }
  return payload.access_token;
}

export async function checkZendeskTicket(): Promise<CheckResult> {
  const subdomain = requiredEnv('ZENDESK_SUBDOMAIN');
  let accessToken = '';
  try {
    accessToken = await zendeskAccessToken();
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
    const identity = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, { headers });
    if (!identity.ok) throw new SmokeFailure(`Zendesk identity read returned HTTP ${identity.status}`);

    const created = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ticket: {
          subject: 'Vendor smoke test - safe to delete',
          comment: { body: 'Automated OTHRM-10 vendor smoke test.' },
        },
      }),
    });
    if (!created.ok) throw new SmokeFailure(`Zendesk ticket create returned HTTP ${created.status}`);
    const createdPayload = await created.json() as { ticket?: { id?: unknown } };
    const ticketId = createdPayload.ticket?.id;
    if (typeof ticketId !== 'number') throw new SmokeFailure('Zendesk ticket create response was incomplete');

    const read = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json`, { headers });
    if (!read.ok) throw new SmokeFailure(`Zendesk ticket read returned HTTP ${read.status}`);
    const readPayload = await read.json() as { ticket?: { id?: unknown } };
    if (readPayload.ticket?.id !== ticketId) throw new SmokeFailure('Zendesk ticket read did not match the created ticket');
  } finally {
    accessToken = '';
  }

  return {
    name: 'Zendesk authenticated ticket',
    detail: 'client-credentials token completed a read-only identity check, then created and read back one disposable trial ticket',
  };
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'othram-vendor-smoke-'));
  const checks: NamedCheck[] = [
    { name: 'OpenAI tool calling', run: checkOpenAiToolCalling },
    { name: 'ElevenLabs Scribe realtime', run: () => checkScribeRealtime(directory) },
    { name: 'ElevenLabs v3 audio tags', run: () => checkV3AudioTags(directory) },
    { name: 'Zendesk authenticated ticket', run: checkZendeskTicket },
  ];
  const failures: string[] = [];

  console.log('Vendor smoke test (throwaway; credentials, tokens, responses, and audio are not logged).');
  try {
    for (const check of checks) {
      try {
        const result = await check.run();
        console.log(`PASS ${result.name}: ${result.detail}`);
      } catch (error) {
        failures.push(check.name);
        console.log(`FAIL ${check.name}: ${safeFailure(error)}`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} vendor smoke check(s) failed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.exitCode = 1;
  });
}
