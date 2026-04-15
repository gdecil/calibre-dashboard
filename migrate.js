const { pool } = require('./database');
const fs = require('fs');
const path = require('path');

// Leggi file migrazione
const migrationFile = path.join(__dirname, 'migrations', '001_create_tables.sql');
const migrationSql = fs.readFileSync(migrationFile, 'utf8');

// Esegui migrazione
pool.query(migrationSql, (error, result) => {
    if (error) {
        console.error('❌ Errore migrazione:', error.message);
        process.exit(1);
    }
    console.log('✅ Migrazione completata con successo');
    process.exit(0);
});