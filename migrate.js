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
    console.log('✅ Migrazione step1 con successo');
    // Leggi file migrazione
    const migrationFile1 = path.join(__dirname, 'migrations', '002_add_enrichment_fields.sql');
    const migrationSql1 = fs.readFileSync(migrationFile1, 'utf8');

    // Esegui migrazione
    pool.query(migrationSql1, (error, result) => {
        if (error) {
            console.error('❌ Errore migrazione:', error.message);
            process.exit(1);
        }
        console.log('✅ Migrazione step2 con successo');
        process.exit(0);
    });
});

