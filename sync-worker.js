const axios = require('axios');
const cron = require('node-cron');
const { initializeDatabase, backupDatabase, cleanupOldBackups, upsertBook } = require('./database');
require('dotenv').config();

// URL del server Calibre
const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';

// Cron job per sincronizzazione notturna (23:00)
cron.schedule(process.env.SYNC_CRON_SCHEDULE || '0 23 * * *', async () => {
    console.log('🔄 Avvio sincronizzazione notturna...');
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
    } catch (error) {
        console.error('❌ Errore sincronizzazione:', error.message);
        // In caso di errore, ripristina ultimo backup
        await restoreLastBackup();
    }
}, {
    scheduled: true,
    timezone: 'Europe/Rome'
});

// Fetch libri dal server Calibre
async function fetchBooksFromCalibre() {
    try {
        console.log('📥 Recupero libri da Calibre...');
        const response = await axios.get(`${CALIBRE_URL}/interface-data/books-init`, {
            timeout: 30000,
            headers: { 'Accept': 'application/json' }
        });
        return Object.values(response.data.books || {});
    } catch (error) {
        console.error('❌ Impossibile raggiungere server Calibre:', error.message);
        throw error;
    }
}

// Aggiorna libri letti nel database
async function updateReadBooks(books) {
    try {
        console.log(`📋 Elaborazione ${books.length} libri letti...`);
        for (const book of books) {
            const bookData = {
                id: book.id,
                title: book.title,
                authors: book.authors,
                tags: book.tags,
                publisher: book.publisher,
                published_date: book.pubdate,
                isbn: book.isbn,
                language: book.language,
                last_modified: book.last_modified,
                rating: book.user_metadata && book.user_metadata['#rating'] 
                    ? Math.round(book.user_metadata['#rating'].value) 
                    : null
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
        const { pool } = require('./database');
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
        console.error('❌ Errore ripristino backup:', error.message);
    }
}

// Avvia il worker
async function startSyncWorker() {
    try {
        console.log('🚀 Avvio worker di sincronizzazione...');
        await initializeDatabase();
        console.log(`⏰ Sincronizzazione programmata: ${process.env.SYNC_CRON_SCHEDULE || 'ogni giorno alle 23:00'}`);
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
    startSyncWorker
};

// Avvia automaticamente se eseguito direttamente
if (require.main === module) {
    startSyncWorker();
}