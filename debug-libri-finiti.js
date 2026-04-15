const axios = require('axios');
require('dotenv').config();

const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';

async function debugLibriFinito() {
    try {
        console.log('🔍 Analisi dettagliata libri finiti...');

        // Ottieni i libri finiti usando l'URL corretto
        const response = await axios.get(`${CALIBRE_URL}/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca`, {
            timeout: 30000,
            headers: { 'Accept': 'application/atom+xml' }
        });

        console.log('✅ Libri finiti ottenuti');
        console.log('📝 Analisi delle prime 3 entry:');

        // Parsing del feed OPDS
        const parseString = require('xml2js').parseString;

        await new Promise((resolve, reject) => {
            parseString(response.data, (err, result) => {
                if (err) {
                    console.error('❌ Errore parsing XML:', err.message);
                    reject(err);
                    return;
                }

                const entries = result.feed.entry || [];
                console.log(`📚 Numero totale di libri: ${entries.length}`);

                // Analizza le prime 3 entry in dettaglio
                for (let i = 0; i < Math.min(3, entries.length); i++) {
                    const entry = entries[i];
                    console.log(`\n--- Libro ${i+1}: ${entry.title?.[0] || 'Sconosciuto'} ---`);

                    // ID e autori
                    console.log(`ID: ${entry.id?.[0] || 'N/A'}`);
                    console.log(`Autore: ${entry.author?.[0]?.name?.[0] || 'N/A'}`);

                    // Categorie
                    const categories = entry.category || [];
                    if (categories.length > 0) {
                        console.log('Categorie:');
                        categories.forEach(cat => {
                            console.log(`  - ${cat.$?.term} (${cat.$?.label || 'N/A'})`);
                        });
                    }

                    // Data e aggiornamento
                    console.log(`Data: ${entry['dc:date']?.[0] || 'N/A'}`);
                    console.log(`Aggiornato: ${entry.updated?.[0] || 'N/A'}`);

                    // Contenuto
                    const content = entry.content?.[0] || '';
                    if (content) {
                        console.log('Contenuto (primi 200 char):');
                        console.log(content.toString().substring(0, 200));
                    }
                }

                resolve();
            });
        });

    } catch (error) {
        console.error('❌ Errore analisi libri finiti:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
        }
    }
}

debugLibriFinito();