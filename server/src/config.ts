import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root is two levels up from server/src (or server/dist).
const repoRoot = path.resolve(__dirname, '..', '..');

function resolveDir(value: string, fallback: string): string {
  const raw = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

export interface Config {
  port: number;
  libraryDir: string;
  dataDir: string;
  dbPath: string;
  coversDir: string;
  publicBaseUrl: string;
  authToken: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  webDist: string;
}

function loadDotEnv(): void {
  const envPath = path.resolve(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadConfig(): Config {
  loadDotEnv();

  const dataDir = resolveDir(process.env.DATA_DIR ?? '', './data');
  const libraryDir = resolveDir(process.env.LIBRARY_DIR ?? '', './library');
  const coversDir = path.join(dataDir, 'covers');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(coversDir, { recursive: true });

  const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const logLevel = (['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info') as Config['logLevel'];

  return {
    port: Number.parseInt(process.env.PORT ?? '4321', 10),
    libraryDir,
    dataDir,
    dbPath: path.join(dataDir, 'bibliotekarz.db'),
    coversDir,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, ''),
    authToken: (process.env.AUTH_TOKEN ?? '').trim(),
    logLevel,
    webDist: path.resolve(repoRoot, 'web', 'dist'),
  };
}
