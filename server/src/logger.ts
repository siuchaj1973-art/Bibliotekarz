type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let current: Level = 'info';

export function setLogLevel(level: Level): void {
  current = level;
}

function emit(level: Level, args: unknown[]): void {
  if (order[level] < order[current]) return;
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const line = `${ts} ${tag}`;
  if (level === 'error') console.error(line, ...args);
  else if (level === 'warn') console.warn(line, ...args);
  else console.log(line, ...args);
}

export const log = {
  debug: (...a: unknown[]) => emit('debug', a),
  info: (...a: unknown[]) => emit('info', a),
  warn: (...a: unknown[]) => emit('warn', a),
  error: (...a: unknown[]) => emit('error', a),
};
