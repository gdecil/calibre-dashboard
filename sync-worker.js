const axios = require('axios');
const cron = require('node-cron');
const { initializeDatabase, backupDatabase, cleanupOldBackups, upsertBook } = require('./database');
require('dotenv').config();

// URL del server Calibre
const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';

// Credenziali Calibre
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || 'gdecil';
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || '';

// Crea header di autenticazione
const authHeader = {
    username: CALIBRE_USERNAME,
    password: CALIBRE_PASSWORD
};

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

// Fetch libri dal server Calibre usando API OPDS
async function fetchBooksFromCalibre() {
    try {
        console.log('📥 Recupero libri da Calibre tramite OPDS...');

        // Crea header di autenticazione Basic Auth
        const authConfig = {
            auth: {
                username: CALIBRE_USERNAME,
                password: CALIBRE_PASSWORD
            },
            timeout: 30000,
            headers: { 'Accept': 'application/atom+xml' }
        };

        // Prima otteniamo l'elenco dei libri letti (status "Finito")
        const response = await axios.get(`${CALIBRE_URL}/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca`, authConfig);

        // Parsing del feed OPDS per trovare il link ai libri "Finito"
        const parseString = require('xml2js').parseString;
        let finishedBooksUrl = null;

        await new Promise((resolve, reject) => {
            parseString(response.data, (err, result) => {
                if (err) {
                    console.error('❌ Errore parsing XML:', err.message);
                    reject(err);
                    return;
                }

                // Cerca l'entry con titolo "Finito"
                const entries = result.feed.entry || [];
                for (const entry of entries) {
                    const title = entry.title?.[0];
                    if (title === 'Finito') {
                        const links = entry.link || [];
                        for (const link of links) {
                            if (link.$ && link.$.rel === 'http://opds-spec.org/acquisition') {
                                finishedBooksUrl = link.$.href;
                                break;
                            }
                        }
                        break;
                    }
                }

                if (!finishedBooksUrl) {
                    console.error('❌ Impossibile trovare URL libri finiti');
                    reject(new Error('URL libri finiti non trovato'));
                    return;
                }

                resolve();
            });
        });

        // Ora otteniamo i libri effettivi dal feed dei libri finiti
        const booksResponse = await axios.get(`${CALIBRE_URL}${finishedBooksUrl}`, authConfig);

        // Parsing dei libri dal feed OPDS
        const books = [];
        await new Promise((resolve, reject) => {
            parseString(booksResponse.data, (err, result) => {
                if (err) {
                    console.error('❌ Errore parsing XML libri:', err.message);
                    reject(err);
                    return;
                }

                const entries = result.feed.entry || [];
                for (const entry of entries) {
                    try {
                        const book = {
                            uuid: entry.id?.[0]?.replace('urn:uuid:', '') || null,
                            title: entry.title?.[0] || 'Sconosciuto',
                            authors: entry.author?.[0]?.name?.[0] || 'Sconosciuto',
                            pubdate: entry['dc:date']?.[0] || null,
                            last_modified: entry.updated?.[0] || null,
                            user_metadata: {
                                '#read': { value: true },
                                '#rating': { value: null }
                            },
                            tags: [],
                            publisher: null,
                            identifiers: {},
                            languages: []
                        };

// Estraiamo informazioni dal content
const content = entry.content?.[0] || '';
if (content) {
    // Parsing delle informazioni dal content XHTML usando regex direttamente
    const contentStr = content.toString();

    // Estraiamo i tag
    const tagMatch = contentStr.match(/TAG: ([^\n]+)/);
    if (tagMatch) {
        book.tags = tagMatch[1].split(', ').map(tag => tag.trim());
    }

    // Estraiamo il publisher se presente
    const publisherMatch = contentStr.match(/Editore: ([^\n]+)/);
    if (publisherMatch) {
        book.publisher = publisherMatch[1].trim();
    }

    // Estraiamo la lingua se presente
    const languageMatch = contentStr.match(/Lingua: ([^\n]+)/);
    if (languageMatch) {
        book.languages = [languageMatch[1].trim()];
    }

    // Estraiamo il rating se presente
    const ratingMatch = contentStr.match(/Valutazione: (\d+)/);
    if (ratingMatch) {
        book.user_metadata['#rating'] = { value: parseInt(ratingMatch[1]) };
    }
}

                        books.push(book);
                    } catch (error) {
                        console.error('❌ Errore parsing libro:', error.message);
                        // Continua con il prossimo libro
                    }
                }

                resolve();
            });
        });

        return books;
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
                id: book.uuid,
                title: book.title,
                authors: book.authors, // Già in formato JSON stringa
                tags: book.tags, // Già in formato JSON stringa
                publisher: book.publisher,
                published_date: book.pubdate,
                isbn: book.identifiers?.isbn,
                language: book.languages?.[0],
                last_modified: book.last_modified,
                rating: book.user_metadata['#rating']?.value || null
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