require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const outputFile = process.argv[2] || path.join(process.cwd(), 'backups', `calibre_${new Date().toISOString().slice(0,10)}_${Date.now()}.dump`);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL mancante');
}

const pgDumpPath = 'c:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const result = spawnSync(pgDumpPath, ['--format=custom', '--file', outputFile, databaseUrl], {
  stdio: 'inherit'
});

if (result.status !== 0) {
    process.exit(result.status || 1);
}

console.log(`✅ Dump creato: ${outputFile}`);

// Registra il backup nel database per coerenza
const stats = fs.statSync(outputFile);
const pool = new Pool({ connectionString: databaseUrl });

pool.query(
    'INSERT INTO backups (filename, size) VALUES ($1, $2)',
    [path.basename(outputFile), stats.size],
    (err) => {
        if (err) console.error('❌ Errore registrazione backup:', err.message);
        else console.log('✅ Backup registrato nel database');
        pool.end();
    }
);
