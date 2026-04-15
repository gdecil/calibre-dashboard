const axios = require('axios');
require('dotenv').config();

const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';

async function debugCalibreStructure() {
    try {
        console.log('🔍 Esplorazione struttura server Calibre...');

        // Prova a ottenere il catalogo principale
        console.log('📋 Recupero catalogo principale...');
        const mainResponse = await axios.get(`${CALIBRE_URL}/opds`, {
            timeout: 10000,
            headers: { 'Accept': 'application/atom+xml' }
        });

        console.log('✅ Catalogo principale ottenuto');
        console.log('📝 Contenuto completo:');
        console.log(mainResponse.data);
        console.log('\n🔍 Analisi dei link disponibili:');

        // Cerca tutti i link nel feed
        const parseString = require('xml2js').parseString;
        parseString(mainResponse.data, (err, result) => {
            if (!err && result.feed && result.feed.link) {
                const links = result.feed.link;
                for (const link of links) {
                    if (link.$) {
                        console.log(`  - ${link.$.rel || 'unknown'}: ${link.$.href}`);
                    }
                }
            }
        });

        // Prova a ottenere la navigazione della libreria
        console.log('\n📋 Recupero navigazione libreria...');
        const navResponse = await axios.get(`${CALIBRE_URL}/opds/navcatalog`, {
            timeout: 10000,
            headers: { 'Accept': 'application/atom+xml' }
        });

        console.log('✅ Navigazione libreria ottenuta');
        console.log('📝 Contenuto (primi 1000 caratteri):');
        console.log(navResponse.data.substring(0, 1000));

        // Prova a ottenere tutti i libri
        console.log('\n📋 Recupero tutti i libri...');
        const booksResponse = await axios.get(`${CALIBRE_URL}/opds/books`, {
            timeout: 10000,
            headers: { 'Accept': 'application/atom+xml' }
        });

        console.log('✅ Libri ottenuti');
        console.log('📝 Numero di entry trovate:', (booksResponse.data.match(/<entry/g) || []).length);

    } catch (error) {
        console.error('❌ Errore esplorazione Calibre:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

debugCalibreStructure();