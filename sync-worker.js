require('dotenv').config();
const cron = require('node-cron');
const { initializeDatabase, backupDatabase, cleanupOldBackups, upsertBook } = require('./database');
const { fetchBooksFromCalibre } = require('./services/calibre-opds');

// Funzione per sincronizzazione manuale
async function manualSync() {
    console.log('🔄 Avvio sincronizzazione manuale...');
    try {
        // Backup database prima della sincronizzazione
        await backupDatabase();

        // Ottieni libri dal server Calibre
        const books = await fetchBooksFromCalibre();

        // Processa solo libri letti
        const readBooks = books.filter(book =>
            book.user_metadata &&
            book.user_metadata['#read'] &&
            book.user_metadata['#read'].value === true
        );

        // Aggiorna database con libri letti
        await updateReadBooks(readBooks);

        // Pulisci backup vecchi
        await cleanupOldBackups();

        console.log(`✅ Sincronizzazione completata: ${readBooks.length} libri letti aggiornati`);
        return readBooks.length;
    } catch (error) {
        console.error('❌ Errore sincronizzazione:', error.message);
        // In caso di errore, ripristina ultimo backup
        await restoreLastBackup();
        throw error;
    }
}

// Cron job per sincronizzazione notturna (23:00) - DISABILITATO per sincronizzazione manuale
// cron.schedule(process.env.SYNC_CRON_SCHEDULE || '0 23 * * *', async () => {
//     console.log('🔄 Avvio sincronizzazione notturna...');
//     try {
//         await manualSync();
//     } catch (error) {
//         console.error('❌ Errore sincronizzazione automatica:', error.message);
//     }
// }, {
//     scheduled: true,
//     timezone: 'Europe/Rome'
// });

// Aggiorna libri letti nel database
async function updateReadBooks(books) {
    try {
        console.log(`📋 Elaborazione ${books.length} libri letti...`);
        for (const book of books) {
            const bookData = {
                id: book.uuid,
                title: book.title,
                authors: book.authors,
                tags: book.tags,
                publisher: book.publisher,
                published_date: book.pubdate,
                isbn: book.identifiers?.isbn,
                language: book.languages?.[0],
                last_modified: book.last_modified,
                rating: book.user_metadata['#rating']?.value || null,
                reading_order: book.reading_order
            };
            await upsertBook(bookData);
        }
    } catch (error) {
        console.error('❌ Errore aggiornamento libri:', error.message);
        throw error;
    }
}

// Ripristina ultimo backup
async function restoreLastBackup() {
    try {
        const { pool } = require('child_process');
        // Verifica se la tabella backups esiste
        try {
            const result = await pool.query('SELECT filename FROM backups ORDER BY created_at DESC LIMIT 1');
            if (result.rows.length > 0) {
                const filename = result.rows[0].filename;
                const command = `psql -U postgres -d calibre -f backups/${filename}`;

                const { exec } = require('child_process');
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ Errore ripristino backup:', error.message);
                        return;
                    }
                    console.log(`✅ Ripristino backup completato: ${filename}`);
                });
            }
        } catch (error) {
            console.warn('⚠️  Tabella backups non esiste o database non configurato');
        }
    } catch (error) {
        console.error('❌ Errore ripristino backup:', error.message);
    }
}

// Avvia il worker
async function startSyncWorker() {
    try {
        console.log('🚀 Avvio worker di sincronizzazione...');

        // Validazione variabili d'ambiente
        if (!process.env.DATABASE_URL) {
            console.error('❌ Variabile d\'ambiente DATABASE_URL non configurata');
            process.exit(1);
        }

        // Test connessione database
        console.log('🔌 Test connessione database...');
        const dbConnected = await initializeDatabase();
        if (!dbConnected) {
            console.error('❌ Impossibile connettersi al database');
            process.exit(1);
        }

        // La connessione al server Calibre viene effettuata solo durante la sincronizzazione
        console.log('✅ Worker avviato con successo');
        console.log('📚 La connessione al server Calibre verrà effettuata solo durante gli aggiornamenti del database');
    } catch (error) {
        console.error('❌ Errore avvio worker:', error.message);
        process.exit(1);
    }
}

// Esporta funzioni per test
module.exports = {
    fetchBooksFromCalibre,
    updateReadBooks,
    restoreLastBackup,
    startSyncWorker,
    manualSync
};

// Avvia automaticamente se eseguito direttamente
if (require.main === module) {
    startSyncWorker();
}