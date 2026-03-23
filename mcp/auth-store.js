import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CREDENTIALS_PATH = join(homedir(), '.onchainchess-bot');

export function loadCredentials() {
  try {
    const data = readFileSync(CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.username && parsed.token) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCredentials(username, token) {
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ username, token }, null, 2), 'utf-8');
}
