#!/usr/bin/env node
require('dotenv').config();
const BookEnricher = require('../services/book-enricher');

async function main() {
    const args = process.argv.slice(2);
    let limit = 10; // Default: enrich 10 books

    // Parse command line arguments
    if (args[0] && args[0].startsWith('--limit=')) {
        limit = parseInt(args[0].split('=')[1]) || 10;
    } else if (args[0] && !isNaN(parseInt(args[0]))) {
        limit = parseInt(args[0]);
    }

    console.log('🔄 Avvio processo di arricchimento libri...');
    console.log(`📚 Numero di libri da processare: ${limit}`);

    const enricher = new BookEnricher();

    try {
        const results = await enricher.batchEnrichBooks(limit);

        console.log('\n📊 Risultati dell\'arricchimento:');
        console.log(`  Libri processati: ${results.totalProcessed}`);
        console.log(`  Arricchiti con successo: ${results.successfullyEnriched}`);
        console.log(`  Senza cambiamenti: ${results.noChanges}`);
        console.log(`  Fallimenti: ${results.failed}`);

        if (results.error) {
            console.error(`\n❌ Errore: ${results.error}`);
        } else {
            console.log('\n✅ Processo di arricchimento completato!');
        }
    } catch (error) {
        console.error('❌ Errore durante l\'arricchimento:', error.message);
        process.exit(1);
    }
}

main();