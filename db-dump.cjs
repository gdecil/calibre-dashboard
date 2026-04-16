require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

const outputFile = process.argv[2] || path.join(process.cwd(), 'backups', `calibre_${new Date().toISOString().slice(0,10)}_${Date.now()}.dump`);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL mancante');
}

const pgDumpPath = 'd:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const result = spawnSync(pgDumpPath, ['--format=custom', '--file', outputFile, databaseUrl], {
  stdio: 'inherit'
});

if (result.status !== 0) {
    process.exit(result.status || 1);
}

console.log(`Dump creato: ${outputFile}`);
