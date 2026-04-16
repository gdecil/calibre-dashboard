/**
 * Test di integrazione per il processo di arricchimento libri.
 */
const BookEnricher = require('../services/book-enricher');
require('dotenv').config();

describe('BookEnricher Integration', () => {
    let enricher;

    beforeAll(() => {
        enricher = new BookEnricher();
    });

    test('batchEnrichBooks dovrebbe restituire un riepilogo dei risultati', async () => {
        // Testiamo con un limite di 1 per velocità
        const limit = 1;
        const results = await enricher.batchEnrichBooks(limit);

        // Verifichiamo la struttura della risposta
        expect(results).toBeDefined();
        expect(results).toHaveProperty('totalProcessed');
        expect(results).toHaveProperty('successfullyEnriched');
        expect(results).toHaveProperty('noChanges');
        expect(results).toHaveProperty('failed');
        
        // Il test deve fallire se ci sono errori tecnici o di validazione
        expect(results.error).toBeUndefined();
        expect(results.failed).toBe(0);
    });
});