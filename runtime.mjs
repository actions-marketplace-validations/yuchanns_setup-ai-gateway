import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function compose(state, args, options = {}) {
  return execFileSync('docker', ['compose', '--project-name', state.project,
    '--file', state.compose, ...args], {
    env: { ...process.env, ...state.environment },
    encoding: 'utf8',
    ...options,
  });
}

export function record(file, values) {
  for (const [name, value] of Object.entries(values)) {
    appendFileSync(file, `${name}=${value}\n`, { mode: 0o600 });
  }
}

