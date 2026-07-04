import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './http.js';
import { scanLibrary } from './scanner.js';
import { log, setLogLevel } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const db = openDatabase(config.dbPath);
  const command = process.argv[2] ?? 'serve';

  if (command === 'scan') {
    log.info(`Skanowanie biblioteki: ${config.libraryDir}`);
    const result = await scanLibrary(db, config);
    log.info(
      `Gotowe w ${result.durationMs}ms — przeskanowano ${result.scannedFiles} plików, ` +
        `dodano ${result.addedItems}, zaktualizowano ${result.updatedItems}, usunięto ${result.removedItems}.`,
    );
    if (result.errors.length) {
      log.warn(`${result.errors.length} błędów:`);
      for (const e of result.errors.slice(0, 20)) log.warn(`  ${e.path}: ${e.message}`);
    }
    db.close();
    return;
  }

  if (command === 'serve') {
    const app = createApp(db, config);
    const server = app.listen(config.port, () => {
      log.info(`Bibliotekarz działa na http://localhost:${config.port}`);
      log.info(`Biblioteka: ${config.libraryDir}`);
      log.info(`Dane:       ${config.dataDir}`);
      if (!config.authToken) log.warn('AUTH_TOKEN nie ustawiony — API jest otwarte (OK dla localhost / zaufanej sieci).');
    });
    const shutdown = () => {
      log.info('Zamykanie...');
      server.close(() => {
        db.close();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  log.error(`Nieznana komenda: ${command}. Użyj "serve" lub "scan".`);
  process.exit(1);
}

main().catch((err) => {
  log.error('Błąd krytyczny:', err);
  process.exit(1);
});
