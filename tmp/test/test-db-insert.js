const { pool } = require('./database');

async function testInsert() {
    try {
        console.log('🧪 Test inserimento nel database...');

        // Test con dati semplici
        const simpleBook = {
            id: 'test-123',
            title: 'Libro di test',
            authors: JSON.stringify(['Autore Test']),
            tags: JSON.stringify(['tag1', 'tag2']),
            publisher: 'Editore Test',
            published_date: '2023-01-01',
            isbn: '1234567890',
            language: 'IT',
            last_modified: '2023-01-01T10:00:00',
            rating: 4
        };

        console.log('Dati da inserire:', simpleBook);

        const query = `
            INSERT INTO read_books (id, title, authors, tags, publisher, published_date, isbn, language, last_modified, rating)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
        `;

        await pool.query(query, [
            simpleBook.id,
            simpleBook.title,
            simpleBook.authors,
            simpleBook.tags,
            simpleBook.publisher,
            simpleBook.published_date,
            simpleBook.isbn,
            simpleBook.language,
            simpleBook.last_modified,
            simpleBook.rating
        ]);

        console.log('✅ Inserimento di test completato con successo!');
    } catch (error) {
        console.error('❌ Errore inserimento test:', error.message);
        console.error('Dettagli:', error.detail);
    } finally {
        process.exit(0);
    }
}

testInsert();