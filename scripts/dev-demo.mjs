// Local integration runner. Invoke Node CLIs directly so Windows needs no POSIX shell.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const login = process.env.CHESS_LOGIN_DIR || path.resolve(root, '../login-accounts');
if (!existsSync(path.join(login, 'apps/server/src/oidc/routes.ts'))) {
  throw new Error('Set CHESS_LOGIN_DIR to the merged Login checkout.');
}
const rootRequire = createRequire(path.join(root, 'package.json'));
const loginRequire = createRequire(path.join(login, 'package.json'));
let loginTsx, loginVite, chessVite;
try {
  loginTsx = loginRequire.resolve('tsx/cli');
  loginVite = path.join(path.dirname(loginRequire.resolve('vite/package.json')), 'bin/vite.js');
  chessVite = path.join(path.dirname(rootRequire.resolve('vite/package.json')), 'bin/vite.js');
} catch {
  console.error('Install dependencies first: npm ci in both checkouts, then npm --prefix server ci in chess-ui.');
  process.exit(1);
}

const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') {
        // Kill only this runner's child process trees, including the tsx watcher.
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch { /* Already stopped. */ }
  }
}
function start(cwd, args, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd, env: { ...process.env, ...extra }, stdio: 'inherit',
    detached: process.platform !== 'win32', windowsHide: true,
  });
  children.push(child);
  child.on('error', () => {
    console.error('Could not start a demo process.'); process.exitCode = 1; stop();
  });
  child.on('exit', code => {
    if (!stopping) { process.exitCode = code ?? 1; stop(); }
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start(path.join(login, 'apps/server'), [
  '--env-file-if-exists=../../.env', loginTsx, 'watch', 'src/main.ts',
], { OIDC_ENABLED: '1', DEV_OUTBOX: '1', PORT: '8787',
  DB_PATH: process.env.DB_PATH || path.join(login, 'apps/server/login-dev.sqlite') });
start(path.join(login, 'apps/web'), [loginVite]);
start(path.join(root, 'server'), ['index.js'], {
  LOGIN_ISSUER: 'http://localhost:5180/oidc', CHESS_ORIGIN: 'http://localhost:5190', PORT: '3001',
});
start(root, [chessVite]);
console.log('Local demo: Login 5180, chess 5190, Login API 8787, chess API 3001. Ctrl+C stops this runner.');
