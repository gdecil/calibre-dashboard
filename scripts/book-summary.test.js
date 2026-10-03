const Database = require('better-sqlite3');
const {
    getBookSummaryChunks,
    isBookSummaryRequest,
    isNarrativeChunk,
    selectChapterRepresentativeChunks,
    splitSummarySources,
    restoreSummaryCitations,
    normalizeSummaryNoteCitations,
    buildSummaryBatchMessages,
    buildSummaryBatchRepairMessages,
    combineSummaryNotes,
    getUncitedSummarySources,
    getBookSummaryChunksByCalibreId
} = require('../services/book-summary');

describe('book summary retrieval', () => {
    test('recognizes summary requests', () => {
        expect(isBookSummaryRequest('riassumi il libro La rabbia degli angeli')).toBe(true);
        expect(isBookSummaryRequest('fammi la sintesi di questo capitolo')).toBe(true);
        expect(isBookSummaryRequest('approfondisci Brightwell')).toBe(false);
    });

    test('selects one central chunk per chapter in narrative order', () => {
        const chunks = [
            { chapter_id: 1, chunk_number: 0 },
            { chapter_id: 1, chunk_number: 1 },
            { chapter_id: 1, chunk_number: 2 },
            { chapter_id: 2, chunk_number: 0 }
        ];
        const sample = selectChapterRepresentativeChunks(chunks);

        expect(sample).toEqual([
            { chapter_id: 1, chunk_number: 1 },
            { chapter_id: 2, chunk_number: 0 }
        ]);
    });

    test('splits chapter sources into bounded, ordered groups and retains citations', () => {
        const sources = Array.from({ length: 21 }, (_, index) => ({ citation: `C${index + 1}` }));
        const batches = splitSummarySources(sources);
        const batchPrompt = buildSummaryBatchMessages('Titolo', batches[0], 1, batches.length, sources.length);

        expect(batches.map((batch) => batch.length)).toEqual([3, 3, 3, 3, 3, 3, 3]);
        expect(batchPrompt[1].content).toContain('[C1]');
        expect(batchPrompt[1].content).toContain('[C3]');
        expect(batchPrompt[0].content).toContain('esattamente un punto elenco per ciascuna delle 3 fonti');
        expect(batchPrompt[0].content).toContain('massimo 22 parole');
        expect(batchPrompt[0].content).toContain('non usare conoscenze sulla serie o sugli altri libri');
        expect(batchPrompt[0].content).toContain('non indovinarli');
        const shortBookPrompt = buildSummaryBatchMessages('Titolo', batches[0], 1, 3, 8);
        expect(shortBookPrompt[0].content).toContain('massimo 60 parole');
        expect(restoreSummaryCitations('Fatto [C1]. Altro [C2].', batches[1])).toBe('Fatto [C4]. Altro [C5].');
        expect(normalizeSummaryNoteCitations('[C1] Titolo | Capitolo 1\n- Fatto narrativo.\n- Secondo fatto.'))
            .toBe('[C1] Titolo | Capitolo 1\n- Fatto narrativo. [C1]\n- Secondo fatto. [C1]');
        expect(normalizeSummaryNoteCitations('-C1: Fatto narrativo.')).toBe('- Fatto narrativo. [C1]');
        expect(getUncitedSummarySources('- [C1] Primo fatto.', batches[0]).map(source => source.citation))
            .toEqual(['C2', 'C3']);
        expect(buildSummaryBatchRepairMessages(batchPrompt, 'Un solo fatto [C1].', batches[0]).at(-1).content)
            .toContain('esattamente un punto elenco per ciascuna fonte');
        expect(combineSummaryNotes(['Primo gruppo [C1].', 'Secondo gruppo [C4].']))
            .toBe('Primo gruppo [C1].\n\nSecondo gruppo [C4].');
    });

    test('filters contents pages, short structural sections, and acknowledgements', () => {
        expect(isNarrativeChunk({ chapter_words: 121, text: 'Sommario Capitolo 1 Capitolo 2' })).toBe(false);
        expect(isNarrativeChunk({ chapter_words: 442, text: 'Ringraziamenti e note finali' })).toBe(false);
        expect(isNarrativeChunk({ chapter_words: 1800, text: 'La storia comincia in una piccola città.' })).toBe(true);
    });

    test('resolves the longest mentioned title and returns its distributed chunks', () => {
        const database = new Database(':memory:');
        database.exec(`
            CREATE TABLE books (id INTEGER PRIMARY KEY, calibre_id INTEGER, title TEXT, authors TEXT);
            CREATE TABLE extracted_books (id INTEGER PRIMARY KEY, book_id INTEGER, extracted_at TEXT);
            CREATE TABLE extracted_chapters (id INTEGER PRIMARY KEY, extracted_book_id INTEGER, chapter_number INTEGER, title TEXT, words INTEGER, text TEXT);
            CREATE TABLE extracted_chunks (id INTEGER PRIMARY KEY, extracted_book_id INTEGER, chapter_id INTEGER, chunk_number INTEGER, start_char INTEGER, text TEXT);
        `);
        database.prepare('INSERT INTO books VALUES (?, ?, ?, ?)').run(1, 24613, 'La rabbia', 'John Connolly');
        database.prepare('INSERT INTO books VALUES (?, ?, ?, ?)').run(2, 24614, 'La rabbia degli angeli', 'John Connolly');
        database.prepare('INSERT INTO extracted_books VALUES (?, ?, ?)').run(1, 1, '2026-01-01');
        database.prepare('INSERT INTO extracted_books VALUES (?, ?, ?)').run(2, 2, '2026-01-02');
        const insertChapter = database.prepare('INSERT INTO extracted_chapters VALUES (?, ?, ?, ?, ?, ?)');
        insertChapter.run(100, 1, 1, 'Capitolo 1', 1500, 'Testo narrativo del libro La rabbia');
        const insertChunk = database.prepare('INSERT INTO extracted_chunks VALUES (?, ?, ?, ?, ?, ?)');
        for (let chapter = 1; chapter <= 20; chapter += 1) {
            insertChapter.run(chapter, 2, chapter, `Capitolo ${chapter}`, 1500, `Testo narrativo del capitolo ${chapter}`);
            insertChunk.run(chapter, 2, chapter, 0, 0, `Passaggio ${chapter}`);
        }

        const result = getBookSummaryChunks(database, 'riassumi il libro libro La rabbia degli angeli');

        expect(result.book.title).toBe('La rabbia degli angeli');
        expect(result.chunks.map((chunk) => chunk.chapter_number)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
        expect(result.chunks.every((chunk) => chunk.book_title === result.book.title)).toBe(true);
        expect(getBookSummaryChunksByCalibreId(database, 24614).book.title).toBe('La rabbia degli angeli');
        expect(getBookSummaryChunksByCalibreId(database, 24613).book.title).toBe('La rabbia');
        database.close();
    });
});