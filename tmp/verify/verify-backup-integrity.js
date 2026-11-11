const { pool } = require('./database');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function verifyBackupIntegrity() {
    try {
        console.log('🔍 Avvio verifica integrità backup...');

        // 1. Ottieni statistiche attuali dal database
        const dbStats = await pool.query('SELECT COUNT(*) as count FROM read_books');
        const currentBooksCount = parseInt(dbStats.rows[0].count);
        console.log(`📊 Libri attualmente nel database: ${currentBooksCount}`);

        // 2. Controlla l'ultimo backup registrato nel database
        const lastBackupRecord = await pool.query('SELECT * FROM backups ORDER BY created_at DESC LIMIT 1');
        
        if (lastBackupRecord.rows.length === 0) {
            console.log('⚠️  Nessun backup registrato nella tabella "backups".');
        } else {
            const backup = lastBackupRecord.rows[0];
            console.log(`📋 Ultimo backup registrato: ${backup.filename}`);
            console.log(`   Data: ${backup.created_at}`);
            console.log(`   Dimensione registrata: ${(backup.size / 1024).toFixed(2)} KB`);

            // 3. Verifica presenza fisica del file
            const filePath = path.join(__dirname, 'backups', backup.filename);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                console.log(`✅ File trovato su disco: ${backup.filename}`);
                console.log(`   Dimensione reale: ${(stats.size / 1024).toFixed(2)} KB`);
                
                if (Math.abs(stats.size - backup.size) > 1024) {
                    console.log('⚠️  Attenzione: La dimensione del file differisce significativamente da quella registrata.');
                }
            } else {
                console.log(`❌ Errore: Il file ${backup.filename} è registrato nel DB ma non esiste in backups/`);
            }
        }

        // 4. Elenca file orfani (file presenti ma non registrati)
        const backupDir = path.join(__dirname, 'backups');
        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir);
            console.log(`\n📁 File totali nella directory backups: ${files.length}`);
            
            // Se il dump è in formato custom (come quelli di db-dump.cjs), 
            // puoi ispezionarne il contenuto con: pg_restore -l <nome_file>
            console.log('\n💡 Suggerimento: Per vedere i dettagli di un dump .dump, usa:');
            console.log('   "c:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore" -l backups/nome_file.dump');
        }

    } catch (error) {
        console.error('❌ Errore durante la verifica:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    verifyBackupIntegrity();
}