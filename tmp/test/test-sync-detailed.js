const { fetchAllBooksFromCalibre } = require('./sync-manual');
const { updateReadBooks } = require('./sync-worker');

async function testSyncDetailed() {
    try {
        console.log('🔍 Test sincronizzazione con logging dettagliato...');

        // Ottieni i libri
        const books = await fetchAllBooksFromCalibre();
        console.log(`📚 Trovati ${books.length} libri`);

        // Mostra il primo libro per debug
        if (books.length > 0) {
            console.log('📝 Primo libro:', JSON.stringify(books[0], null, 2));
        }

        // Filtra i libri letti
        const readBooks = books.filter(book =>
            book.user_metadata &&
            book.user_metadata['#read'] &&
            book.user_metadata['#read'].value === true
        );

        console.log(`📋 ${readBooks.length} libri letti da sincronizzare`);

        // Prova a sincronizzare un solo libro per debug
        if (readBooks.length > 0) {
            console.log('🔄 Sincronizzazione primo libro...');
            try {
                await updateReadBooks([readBooks[0]]);
                console.log('✅ Primo libro sincronizzato con successo!');
            } catch (error) {
                console.error('❌ Errore sincronizzazione primo libro:', error.message);
                console.error('Dati del libro:', JSON.stringify(readBooks[0], null, 2));
            }
        }

    } catch (error) {
        console.error('❌ Errore test dettagliato:', error.message);
    } finally {
        process.exit(0);
    }
}

testSyncDetailed();