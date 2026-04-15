const { updateReadBooks, startSyncWorker } = require('./sync-worker');
const axios = require('axios');
require('dotenv').config();

const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || 'gdecil';
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || 'SW"3edfr4';

// Configurazione axios con autenticazione
const axiosInstance = axios.create({
    auth: {
        username: CALIBRE_USERNAME,
        password: CALIBRE_PASSWORD
    }
});

// Avvia il worker e poi esegue sincronizzazione manuale semplificata
async function runManualSync() {
    try {
        // Avvia il worker (solo per test connessioni)
        await startSyncWorker();

        // Esegui sincronizzazione manuale semplificata (senza backup)
        console.log('\n🔄 Esecuzione sincronizzazione manuale...');

        // Ottieni tutti i libri direttamente dal server Calibre
        const books = await fetchAllBooksFromCalibre();

        // Processa solo libri letti
        const readBooks = books.filter(book =>
            book.user_metadata &&
            book.user_metadata['#read'] &&
            book.user_metadata['#read'].value === true
        );

        console.log(`📋 Trovati ${readBooks.length} libri letti su ${books.length} totali`);

        // Aggiorna database con libri letti
        await updateReadBooks(readBooks);

        console.log(`✅ Sincronizzazione manuale completata: ${readBooks.length} libri letti aggiornati`);

        // Chiudi il processo
        process.exit(0);
    } catch (error) {
        console.error('❌ Errore durante sincronizzazione manuale:', error.message);
        process.exit(1);
    }
}

// Funzione alternativa per ottenere tutti i libri
async function fetchAllBooksFromCalibre() {
    try {
        console.log('📥 Recupero tutti i libri da Calibre...');

        // Ottieni i libri finiti usando l'URL corretto
        const response = await axiosInstance.get(`${CALIBRE_URL}/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca`, {
            timeout: 30000,
            headers: { 'Accept': 'application/atom+xml' }
        });

        // Parsing del feed OPDS
        const parseString = require('xml2js').parseString;
        const books = [];

        await new Promise((resolve, reject) => {
            parseString(response.data, (err, result) => {
                if (err) {
                    console.error('❌ Errore parsing XML libri:', err.message);
                    reject(err);
                    return;
                }

                const entries = result.feed.entry || [];
                console.log(`📚 Trovate ${entries.length} entry nel feed`);

                for (const entry of entries) {
                    try {
                        // Estraiamo le informazioni dal libro
                        const bookId = entry.id?.[0]?.replace('urn:uuid:', '') || null;
                        const bookTitle = entry.title?.[0] || 'Sconosciuto';

                        // Gestione autori - converti in array JSON valido
                        let bookAuthors = [];
                        if (entry.author) {
                            const authorName = entry.author[0]?.name?.[0];
                            if (authorName) {
                                bookAuthors = [authorName];
                            }
                        }
                        if (bookAuthors.length === 0) {
                            bookAuthors = ['Sconosciuto'];
                        }

                        const book = {
                            uuid: bookId,
                            title: bookTitle,
                            authors: JSON.stringify(bookAuthors), // Converti array in stringa JSON
                            tags: JSON.stringify([]), // Converti array in stringa JSON
                            publisher: null,
                            pubdate: entry['dc:date']?.[0] || null,
                            last_modified: entry.updated?.[0] || null,
                            user_metadata: {
                                '#read': { value: false },
                                '#rating': { value: null }
                            },
                            identifiers: {},
                            languages: []
                        };

                        // Poiché questo feed contiene solo libri "finito" (letti),
                        // tutti i libri sono già contrassegnati come letti
                        book.user_metadata['#read'].value = true;

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

// Esporta funzioni per test
module.exports = {
    runManualSync,
    fetchAllBooksFromCalibre
};

// Avvia automaticamente se eseguito direttamente
if (require.main === module) {
    runManualSync();
}
