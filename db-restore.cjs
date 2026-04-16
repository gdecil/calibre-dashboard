require('dotenv').config();
const { spawnSync } = require('child_process');

const dumpFile = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL mancante');
}
if (!dumpFile) {
    throw new Error('Specifica il file dump: npm run db:restore -- <file.dump>');
}

const pgRestorePath = 'd:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe';
const result = spawnSync(pgRestorePath, ['--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, dumpFile], {
  stdio: 'inherit'
});

if (result.status !== 0) {
    process.exit(result.status || 1);
}

console.log(`Restore completato da: ${dumpFile}`);
