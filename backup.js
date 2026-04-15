const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Crea directory backup se non esiste
const backupDir = 'backups';
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Connessione al database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Crea backup completo del database
async function createBackup() {
    try {
        const date = new Date();
        const filename = `backup_${date.toISOString().slice(0, 19).replace(/:/g, '-')}.sql`;
        const filepath = path.join(backupDir, filename);

        // Esegue pg_dump per creare backup
        const { exec } = require('child_process');
        exec(`pg_dump -U postgres -d calibre -f ${filepath}`, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Errore creazione backup:', error.message);
                return;
            }

            // Ottieni dimensione file
            const stats = fs.statSync(filepath);
            const size = stats.size;

            // Registra backup nel database
            pool.query(
                'INSERT INTO backups (filename, size) VALUES ($1, $2)',
                [filename, size],
                (err, res) => {
                    if (err) {
                        console.error('❌ Errore registrazione backup:', err.message);
                    } else {
                        console.log(`✅ Backup creato: ${filename} (${size} bytes)`);
                    }
                }
            );
        });
    } catch (error) {
        console.error('❌ Errore backup database:', error.message);
    }
}

// Ripristina backup specifico
async function restoreBackup(filename) {
    try {
        const filepath = path.join(backupDir, filename);
        if (!fs.existsSync(filepath)) {
            console.error('❌ File backup non trovato:', filename);
            return;
        }

        // Esegue restore con psql
        const { exec } = require('child_process');
        exec(`psql -U postgres -d calibre -f ${filepath}`, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Errore ripristino backup:', error.message);
                return;
            }
            console.log(`✅ Ripristino backup completato: ${filename}`);
        });
    } catch (error) {
        console.error('❌ Errore ripristino backup:', error.message);
    }
}

// Elimina backup vecchi
async function cleanupOldBackups() {
    try {
        const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 7;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Leggi tutti i backup
        const files = fs.readdirSync(backupDir);
        let deletedCount = 0;

        for (const file of files) {
            if (file.startsWith('backup_') && file.endsWith('.sql')) {
                const filepath = path.join(backupDir, file);
                const stats = fs.statSync(filepath);
                const fileDate = new Date(stats.mtime);

                if (fileDate < cutoffDate) {
                    fs.unlinkSync(filepath);
                    deletedCount++;
                }
            }
        }

        console.log(`✅ Backup vecchi eliminati: ${deletedCount} file (${retentionDays} giorni)`);
    } catch (error) {
        console.error('❌ Errore pulizia backup:', error.message);
    }
}

// Elenca tutti i backup
async function listBackups() {
    try {
        const files = fs.readdirSync(backupDir);
        const backups = [];

        for (const file of files) {
            if (file.startsWith('backup_') && file.endsWith('.sql')) {
                const filepath = path.join(backupDir, file);
                const stats = fs.statSync(filepath);
                backups.push({
                    filename: file,
                    size: stats.size,
                    created_at: stats.mtime
                });
            }
        }

        // Ordina per data decrescente
        backups.sort((a, b) => b.created_at - a.created_at);

        console.log('📋 Elenco backup:');
        backups.forEach(backup => {
            const date = backup.created_at.toISOString().slice(0, 19).replace('T', ' ');
            const size = (backup.size / 1024).toFixed(2);
            console.log(`   • ${backup.filename} - ${size} KB - ${date}`);
        });
    } catch (error) {
        console.error('❌ Errore elenco backup:', error.message);
    }
}

// Avvia backup manuale
async function startBackup() {
    try {
        console.log('🚀 Avvio backup manuale...');
        await createBackup();
        await cleanupOldBackups();
        console.log('✅ Backup manuale completato');
    } catch (error) {
        console.error('❌ Errore backup manuale:', error.message);
    }
}

// Esporta funzioni
module.exports = {
    createBackup,
    restoreBackup,
    cleanupOldBackups,
    listBackups,
    startBackup
};

// Avvia automaticamente se eseguito direttamente
if (require.main === module) {
    startBackup();
}