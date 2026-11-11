const axios = require('axios');
require('dotenv').config();

const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || 'gdecil';
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || '';

async function testCalibre() {
    console.log('🧪 Test connessione Calibre\n');
    console.log(`URL: ${CALIBRE_URL}`);
    console.log(`Username: ${CALIBRE_USERNAME}\n`);

    const authConfig = {
        auth: {
            username: CALIBRE_USERNAME,
            password: CALIBRE_PASSWORD
        },
        timeout: 10000,
        headers: { 'Accept': 'application/atom+xml' }
    };

    try {
        console.log('📍 Fetching...');
        const url = `${CALIBRE_URL}/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca`;
        const response = await axios.get(url, authConfig);

        console.log('✅ Response ricevuto');
        console.log('📏 Lunghezza:', response.data.length);
        
        // Salva response per debug
        const fs = require('fs');
        fs.writeFileSync('test-calibre-response.xml', response.data);
        console.log('💾 Salvato in test-calibre-response.xml\n');

        // Cerca "Finito" nel response
        if (response.data.includes('Finito')) {
            console.log('✅ Trovato: "Finito" nel response');
        } else {
            console.log('❌ NON trovato: "Finito" nel response');
            console.log('   Probabilmente il feed è in una pagina diversa');
        }

        // Mostra primi 2000 caratteri
        console.log('\n--- PREVIEW RESPONSE (primi 2000 car) ---');
        console.log(response.data.substring(0, 2000));
        console.log('--- END PREVIEW ---\n');

    } catch (error) {
        console.error('❌ Errore:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data.substring(0, 500));
        }
    }
}

testCalibre();
