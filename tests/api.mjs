import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.AI_GATEWAY_BASE_URL;
const key = process.env.AI_API_KEY;
const model = process.argv[2];
const prompt = 'Greet the reader in one sentence.';
const bearer = { Authorization: `Bearer ${key}` };
const apis = [
  {
    name: 'chat-completions', path: '/v1/chat/completions', headers: bearer,
    body: { model, max_tokens: 64, messages: [{ role: 'user', content: prompt }] },
    text: data => data.choices?.[0]?.message?.content || '',
    delta: data => data.choices?.[0]?.delta?.content || '',
  },
  {
    name: 'responses', path: '/v1/responses', headers: bearer,
    body: { model, max_output_tokens: 64, input: prompt },
    text: data => data.output.flatMap(item => item.content || []).map(item => item.text || '').join(''),
    delta: data => data.type === 'response.output_text.delta' ? data.delta : '',
  },
  {
    name: 'messages', path: '/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: { model, max_tokens: 64, messages: [{ role: 'user', content: prompt }] },
    text: data => data.content.map(item => item.text || '').join(''),
    delta: data => data.type === 'content_block_delta' ? data.delta?.text || '' : '',
  },
  {
    name: 'gemini', path: `/v1beta/models/${model}:generateContent`,
    streamPath: `/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': key },
    body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 64 } },
    text: data => data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '',
    delta: data => data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '',
  },
];
const artifacts = join(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts');
mkdirSync(artifacts, { recursive: true });
const results = [];
for (const api of apis) {
  for (const stream of [false, true]) {
    const path = stream && api.streamPath ? api.streamPath : api.path;
    const body = api.streamPath ? api.body : { ...api.body, stream };
    const started = performance.now();
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...api.headers }, body: JSON.stringify(body),
    });
    const raw = await response.text();
    assert(response.ok, `${api.name}: HTTP ${response.status}: ${raw}`);
    let text;
    if (stream) {
      assert(response.headers.get('content-type')?.includes('text/event-stream'), `${api.name}: expected SSE`);
      const events = raw.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim()).filter(data => data && data !== '[DONE]').map(data => JSON.parse(data));
      text = events.map(api.delta).join('');
    } else {
      text = api.text(JSON.parse(raw));
    }
    assert(text.trim(), `${api.name}: expected model output`);
    const transport = stream ? 'sse' : 'json';
    results.push({ api: api.name, transport, duration_seconds: (performance.now() - started) / 1000, text_length: text.length });
    writeFileSync(join(artifacts, 'api-results.json'), JSON.stringify(results, null, 2));
    console.log(`${api.name} (${transport}): received model output`);
  }
}
