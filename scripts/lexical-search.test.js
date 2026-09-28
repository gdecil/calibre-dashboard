const SqliteDatabase = require('better-sqlite3');
const {
    FullTextIndexUnavailableError,
    buildMatchQuery,
    searchExactOccurrences
} = require('../services/lexical-search');

function createDatabase() {
    const database = new SqliteDatabase(':memory:');
    database.exec(`
        CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, authors TEXT);
        CREATE TABLE extracted_books (id INTEGER PRIMARY KEY, book_id INTEGER);
        CREATE TABLE extracted_chapters (
            id INTEGER PRIMARY KEY,
            chapter_number INTEGER,
            title TEXT
        );
        CREATE TABLE extracted_chunks (
            id INTEGER PRIMARY KEY,
            extracted_book_id INTEGER,
            chapter_id INTEGER,
            text TEXT
        );
        CREATE VIRTUAL TABLE extracted_chunks_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
        CREATE TABLE fulltext_index_state (
            id INTEGER PRIMARY KEY,
            state TEXT,
            indexed_chunks INTEGER,
            updated_at TEXT,
            error TEXT
        );
        INSERT INTO books VALUES (1, 'Un caso Parker', 'Autrice Uno');
        INSERT INTO books VALUES (2, 'Secondo romanzo', 'Autore Due');
        INSERT INTO extracted_books VALUES (10, 1);
        INSERT INTO extracted_books VALUES (20, 2);
        INSERT INTO extracted_chapters VALUES (100, 1, 'Apertura');
        INSERT INTO extracted_chapters VALUES (200, 2, 'Indagine');
        INSERT INTO extracted_chunks VALUES (1000, 10, 100, 'Parker entra nella stanza.');
        INSERT INTO extracted_chunks VALUES (1001, 10, 100, 'Parker osserva la strada.');
        INSERT INTO extracted_chunks VALUES (2000, 20, 200, 'Parker segue il sospetto.');
        INSERT INTO extracted_chunks_fts(rowid, text)
            SELECT id, text FROM extracted_chunks;
        INSERT INTO fulltext_index_state VALUES (1, 'ready', 3, '2026-09-28T10:00:00Z', NULL);
    `);
    return database;
}

describe('exact lexical search', () => {
    test('builds a safely quoted AND query from Unicode terms', () => {
        expect(buildMatchQuery('Parker Parker – indagine')).toBe('"Parker" AND "indagine"');
        expect(buildMatchQuery('!!!')).toBe('');
    });

    test('groups exact matches by book and returns cited chunks', () => {
        const database = createDatabase();
        try {
            const result = searchExactOccurrences(database, 'Parker');
            expect(result.matched_chunks).toBe(3);
            expect(result.results).toHaveLength(2);
            expect(result.results[0].book_title).toBe('Un caso Parker');
            expect(result.results[0].matching_chunks).toBe(2);
            expect(result.results[0].excerpts[0].text).toContain('Parker entra');
        } finally {
            database.close();
        }
    });

    test('reports a missing or incomplete full-text index clearly', () => {
        const database = createDatabase();
        try {
            database.prepare('UPDATE fulltext_index_state SET state = ? WHERE id = 1').run('building');
            expect(() => searchExactOccurrences(database, 'Parker'))
                .toThrow(FullTextIndexUnavailableError);
        } finally {
            database.close();
        }
    });

    test('marks the result partial when the book limit hides matches', () => {
        const database = createDatabase();
        try {
            const result = searchExactOccurrences(database, 'Parker', { limit: 1 });
            expect(result.results).toHaveLength(1);
            expect(result.matched_books).toBe(2);
            expect(result.has_more).toBe(true);
        } finally {
            database.close();
        }
    });
});