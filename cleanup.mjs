import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compose } from './runtime.mjs';

const path = process.env.STATE_gateway;
if (path && existsSync(path)) {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.environment.MODEL_PATH) {
    try {
      const logs = compose(state, ['logs', '--no-color']);
      writeFileSync(join(state.directory, 'services.log'), logs.replaceAll(state.key, '[gateway key]'));
      console.log('::group::AI gateway service logs');
      console.log(logs.replaceAll(state.key, '[gateway key]'));
      console.log('::endgroup::');
    } catch (error) {
      console.log(`Service log collection: ${error.message.replaceAll(state.key, '[gateway key]')}`);
    } finally {
      compose(state, ['down', '--volumes', '--remove-orphans'], { stdio: 'inherit' });
      const remaining = compose(state, ['ps', '--all', '--quiet']).trim();
      if (remaining) throw new Error('Owned gateway containers remain after cleanup');
      writeFileSync(join(state.directory, 'cleanup.json'), JSON.stringify({
        project: state.project, containersRemoved: true,
      }, null, 2));
      console.log(`Cleaned up ${state.project}`);
    }
  }
  rmSync(path);
}
