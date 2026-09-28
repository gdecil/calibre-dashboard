const FTS_TABLE = 'extracted_chunks_fts';
const DEFAULT_CHUNK_BUDGET = 5000;

class FullTextIndexUnavailableError extends Error {
    constructor(state) {
        super('Indice lessicale non pronto. Eseguire build_fulltext_index.py prima della ricerca esatta.');
        this.name = 'FullTextIndexUnavailableError';
        this.code = 'fulltext_index_unavailable';
        this.state = state;
    }
}

function buildMatchQuery(query) {
    const terms = [...new Set(String(query || '').match(/[\p{L}\p{N}]+/gu) || [])];
    return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

function makeExcerpt(text, query, maxLength = 480) {
    const sourceText = String(text || '');
    if (sourceText.length <= maxLength) return sourceText;

    const terms = String(query || '').match(/[\p{L}\p{N}]+/gu) || [];
    const sourceLower = sourceText.toLocaleLowerCase('it');
    const positions = terms
        .map((term) => sourceLower.indexOf(term.toLocaleLowerCase('it')))
        .filter((position) => position >= 0)
        .sort((first, second) => first - second);
    const matchPosition = positions[0] ?? 0;
    const start = Math.max(0, Math.min(matchPosition - 140, sourceText.length - maxLength));
    const end = Math.min(sourceText.length, start + maxLength);
    return `${start > 0 ? '[...] ' : ''}${sourceText.slice(start, end).trim()}${end < sourceText.length ? ' [...]' : ''}`;
}

function displayChapterTitle(title, chapterNumber) {
    const chapterTitle = String(title || '').trim();
    if (chapterTitle && !/\.(?:html?|xhtml)$/i.test(chapterTitle)) return chapterTitle;

    const number = Number(chapterNumber);
    return Number.isFinite(number) && number > 0 ? `Capitolo ${number}` : 'Capitolo';
}

function searchExactOccurrences(database, query, {
    limit = 100,
    excerptsPerBook = 3,
    chunkBudget = DEFAULT_CHUNK_BUDGET
} = {}) {
    const matchQuery = buildMatchQuery(query);
    if (!matchQuery) return { query, results: [], matched_chunks: 0, has_more: false };

    const state = database.prepare(
        'SELECT state, indexed_chunks, updated_at, error FROM fulltext_index_state WHERE id = 1'
    ).get();
    if (!state || state.state !== 'ready') {
        throw new FullTextIndexUnavailableError(state || null);
    }

    const rows = database.prepare(`
        SELECT
            c.id AS chunk_id,
            c.chapter_id,
            eb.book_id,
            b.title AS book_title,
            b.authors,
            ch.chapter_number,
            ch.title AS chapter_title,
            bm25(${FTS_TABLE}) AS rank
        FROM ${FTS_TABLE}
        JOIN extracted_chunks c ON c.id = ${FTS_TABLE}.rowid
        JOIN extracted_books eb ON eb.id = c.extracted_book_id
        LEFT JOIN books b ON b.id = eb.book_id
        LEFT JOIN extracted_chapters ch ON ch.id = c.chapter_id
        WHERE ${FTS_TABLE} MATCH ?
        ORDER BY rank ASC
        LIMIT ?
    `).all(matchQuery, chunkBudget + 1);
    const totalChunks = database.prepare(
        'SELECT COUNT(*) AS count FROM extracted_chunks'
    ).get().count;

    const hasMore = rows.length > chunkBudget;
    const books = new Map();
    rows.slice(0, chunkBudget).forEach((row) => {
        const key = row.book_id === null ? `chunk:${row.chunk_id}` : `book:${row.book_id}`;
        let group = books.get(key);
        if (!group) {
            group = {
                book_id: row.book_id,
                book_title: row.book_title || 'Titolo non disponibile',
                authors: row.authors || '',
                matching_chunks: 0,
                excerpts: []
            };
            books.set(key, group);
        }

        group.matching_chunks += 1;
        if (group.excerpts.length < excerptsPerBook) {
            group.excerpts.push({
                id: row.chunk_id,
                chunk_id: row.chunk_id,
                chapter_number: row.chapter_number,
                chapter_title: displayChapterTitle(row.chapter_title, row.chapter_number),
                rank: row.rank
            });
        }
    });

    const results = [...books.values()]
        .sort((first, second) => second.matching_chunks - first.matching_chunks)
        .slice(0, limit);
    const excerptIds = results.flatMap((book) => book.excerpts.map((excerpt) => excerpt.chunk_id));
    const textById = new Map();

    if (excerptIds.length) {
        const placeholders = excerptIds.map(() => '?').join(',');
        const textRows = database.prepare(
            `SELECT id, text FROM extracted_chunks WHERE id IN (${placeholders})`
        ).all(...excerptIds);
        textRows.forEach((row) => textById.set(row.id, row.text));
    }

    results.forEach((book) => {
        book.excerpts = book.excerpts.map(({ rank, ...excerpt }) => ({
            ...excerpt,
            text: makeExcerpt(textById.get(excerpt.chunk_id), query)
        }));
    });

    return {
        query,
        results,
        matched_chunks: Math.min(rows.length, chunkBudget),
        matched_books: books.size,
        has_more: hasMore || books.size > limit,
        indexed_chunks: state.indexed_chunks,
        total_chunks: totalChunks,
        is_complete: state.indexed_chunks >= totalChunks,
        indexed_at: state.updated_at
    };
}

module.exports = {
    FullTextIndexUnavailableError,
    buildMatchQuery,
    displayChapterTitle,
    makeExcerpt,
    searchExactOccurrences
};