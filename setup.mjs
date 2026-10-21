import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync,
  renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { compose, record } from './runtime.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'ai-gateway-'));
const state = {
  project: `ai-gateway-${randomBytes(6).toString('hex')}`,
  compose: join(root, 'compose.yml'),
  directory,
  key: randomBytes(32).toString('base64url'),
  environment: {
    GATEWAY_PORT: process.env.INPUT_PORT,
    THREADS: process.env.INPUT_THREADS,
    CONTEXT_SIZE: process.env['INPUT_CONTEXT-SIZE'],
  },
};
const statePath = join(directory, 'state.json');
writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
record(process.env.GITHUB_STATE, { gateway: statePath });
console.log(`::add-mask::${state.key}`);

try {
  const repository = process.env.INPUT_MODEL;
  const filename = process.env['INPUT_MODEL-FILE'];
  const response = await fetch(`https://huggingface.co/api/models/${repository}?blobs=true`);
  if (!response.ok) throw new Error(`Model metadata: HTTP ${response.status}`);
  const model = await response.json();
  const file = model.siblings.find(file => file.rfilename === filename);
  if (!file?.lfs?.sha256) throw new Error(`GGUF file not found: ${filename}`);
  const cache = join(process.env.RUNNER_TOOL_CACHE || directory, 'setup-ai-gateway', 'models');
  mkdirSync(cache, { recursive: true });
  const path = join(cache, `${file.lfs.sha256}.gguf`);
  if (!existsSync(path)) {
    const url = `https://huggingface.co/${repository}/resolve/${model.sha}/${filename}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Model download: HTTP ${response.status}`);
    console.log(`Downloading ${repository}/${filename}`);
    const temporary = `${path}.${state.project}.download`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }));
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (statSync(path).size !== file.lfs.size || hash.digest('hex') !== file.lfs.sha256) {
    throw new Error('GGUF size or SHA256 differs from Hugging Face metadata');
  }
  writeFileSync(join(directory, 'model.json'), JSON.stringify({
    repository, filename, revision: model.sha, sha256: file.lfs.sha256, size: file.lfs.size,
  }, null, 2));
  state.environment.MODEL_PATH = path;
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(`Verified ${repository}/${filename} at ${model.sha}`);
  compose(state, ['up', '--detach', '--wait'], { stdio: 'inherit' });
  compose(state, ['exec', '-T', 'magpie', 'magpie', 'provider', 'add', 'local',
    'url=http://model:8080/v1', 'key=local-only', 'models=local-model']);
  compose(state, ['exec', '-T', 'magpie', 'magpie', 'gateway-key', 'add', 'CI', '--key', '-'], {
    input: `${state.key}\n`,
  });
  const origin = `http://127.0.0.1:${state.environment.GATEWAY_PORT}`;
  const name = 'local/local-model';
  record(process.env.GITHUB_ENV, {
    AI_GATEWAY_BASE_URL: origin, AI_API_KEY: state.key,
  });
  record(process.env.GITHUB_OUTPUT, { 'base-url': origin, 'api-key': state.key, model: name });
  console.log(`AI gateway ready: ${origin} (model ${name})`);
} catch (error) {
  console.error(`::error::${error.message.replaceAll(state.key, '[gateway key]')}`);
  process.exitCode = 1;
}
