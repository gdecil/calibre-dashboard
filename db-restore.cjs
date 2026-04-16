require('dotenv').config();
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dumpFile = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL mancante');
}
if (!dumpFile) {
    throw new Error('Specifica il file dump: npm run db:restore -- <file.dump>');
}

// Verifica che il file dump esista
if (!fs.existsSync(dumpFile)) {
    throw new Error(`File dump non trovato: ${dumpFile}`);
}

// Trova il percorso di pg_restore
let pgRestorePath;
try {
    // Prova a trovare pg_restore nel PATH
    pgRestorePath = execSync('where pg_restore', { encoding: 'utf8' }).trim().split('\n')[0];
    console.log(`✅ Trovato pg_restore: ${pgRestorePath}`);
} catch (error) {
    // Se non trovato nel PATH, prova percorsi comuni
    const commonPaths = [
        'c:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe',
        'c:\\Program Files\\PostgreSQL\\17\\bin\\pg_restore.exe',
        'c:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe',
        'c:\\Program Files\\PostgreSQL\\15\\bin\\pg_restore.exe',
        'c:\\Program Files\\PostgreSQL\\14\\bin\\pg_restore.exe'
    ];

    for (const testPath of commonPaths) {
        if (fs.existsSync(testPath)) {
            pgRestorePath = testPath;
            console.log(`✅ Trovato pg_restore: ${pgRestorePath}`);
            break;
        }
    }

    if (!pgRestorePath) {
        throw new Error('pg_restore non trovato. Assicurati che PostgreSQL sia installato e nel PATH.');
    }
}

// Esegui il restore
console.log(`🔄 Avvio restore del database da ${dumpFile}...`);
const result = spawnSync(pgRestorePath, ['--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, dumpFile], {
  stdio: 'inherit'
});

if (result.status !== 0) {
    console.error('❌ Errore durante il restore del database');
    process.exit(result.status || 1);
}

console.log(`✅ Restore completato da: ${dumpFile}`);
