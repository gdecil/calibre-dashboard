const axios = require('axios');
require('dotenv').config();

const CALIBRE_URL = process.env.CALIBRE_URL || 'http://192.168.1.5:8090';
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || 'gdecil';
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || '';

async function testAuthMethods() {
    console.log('🔍 Test metodi di autenticazione Calibre...');

    // Test 1: Nessuna autenticazione
    console.log('\n1. Test senza autenticazione...');
    try {
        const response = await axios.get(`${CALIBRE_URL}/opds`, {
            timeout: 5000,
            headers: { 'Accept': 'application/atom+xml' }
        });
        console.log('✅ Successo senza auth');
    } catch (error) {
        console.log(`❌ Fallito: ${error.response?.status || error.message}`);
    }

    // Test 2: Basic Auth
    console.log('\n2. Test con Basic Auth...');
    try {
        const response = await axios.get(`${CALIBRE_URL}/opds`, {
            timeout: 5000,
            headers: { 'Accept': 'application/atom+xml' },
            auth: {
                username: CALIBRE_USERNAME,
                password: CALIBRE_PASSWORD
            }
        });
        console.log('✅ Successo con Basic Auth');
    } catch (error) {
        console.log(`❌ Fallito: ${error.response?.status || error.message}`);
    }

    // Test 3: Parametri URL
    console.log('\n3. Test con parametri URL...');
    try {
        const authUrl = `${CALIBRE_URL}/opds?username=${encodeURIComponent(CALIBRE_USERNAME)}&password=${encodeURIComponent(CALIBRE_PASSWORD)}`;
        const response = await axios.get(authUrl, {
            timeout: 5000,
            headers: { 'Accept': 'application/atom+xml' }
        });
        console.log('✅ Successo con parametri URL');
    } catch (error) {
        console.log(`❌ Fallito: ${error.response?.status || error.message}`);
    }

    // Test 4: Header personalizzato
    console.log('\n4. Test con header Authorization personalizzato...');
    try {
        const token = Buffer.from(`${CALIBRE_USERNAME}:${CALIBRE_PASSWORD}`).toString('base64');
        const response = await axios.get(`${CALIBRE_URL}/opds`, {
            timeout: 5000,
            headers: {
                'Accept': 'application/atom+xml',
                'Authorization': `Basic ${token}`
            }
        });
        console.log('✅ Successo con header personalizzato');
    } catch (error) {
        console.log(`❌ Fallito: ${error.response?.status || error.message}`);
    }

    console.log('\n📋 Test completati');
    process.exit(0);
}

testAuthMethods();