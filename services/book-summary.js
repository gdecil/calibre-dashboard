function normalizeTitle(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('it')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isBookSummaryRequest(question) {
    return /\b(?:riassum\w*|sintesi|sintetizza)\b/i.test(String(question || ''));
}

function isNarrativeChunk(chunk) {
    if (Number(chunk.chapter_words) < 250) return false;
    const lead = normalizeTitle(`${chunk.chapter_title || ''} ${String(chunk.text || '').slice(0, 120)}`);
    return !/(?:^| )(?:sommario|frontespizio|ringraziamenti|indice|copyright)(?: |$)/.test(lead);
}

function selectChapterRepresentativeChunks(chunks) {
    const chapters = new Map();
    for (const chunk of chunks) {
        const chapterChunks = chapters.get(chunk.chapter_id) || [];
        chapterChunks.push(chunk);
        chapters.set(chunk.chapter_id, chapterChunks);
    }

    return [...chapters.values()].map((chapterChunks) =>
        chapterChunks[Math.floor((chapterChunks.length - 1) / 2)]
    );
}

function splitSummarySources(sources, batchSize = 3) {
    const batches = [];
    for (let index = 0; index < sources.length; index += batchSize) {
        batches.push(sources.slice(index, index + batchSize));
    }
    return batches;
}

function restoreSummaryCitations(note, sources) {
    return String(note || '').replace(/\[C(\d+)\]/g, (citation, number) => {
        const source = sources[Number(number) - 1];
        return source ? `[${source.citation}]` : citation;
    });
}

function normalizeSummaryNoteCitations(note) {
    let currentCitations = [];
    return String(note || '').split(/\r?\n/).map((line) => {
        const labelledBullet = line.match(/^(\s*[-*•]\s*)-?C(\d+)\s*:\s*(.*)$/);
        if (labelledBullet) {
            return `${labelledBullet[1].trimEnd()} ${labelledBullet[3].trimEnd()} [C${labelledBullet[2]}]`;
        }
        const citations = [...line.matchAll(/\[C(\d+)\]/g)].map((match) => `C${match[1]}`);
        if (citations.length && /\bCapitolo\b/i.test(line)) {
            currentCitations = [...new Set(citations)];
        }
        if (/^\s*[-*•]\s+/.test(line) && !citations.length && currentCitations.length) {
            return `${line.trimEnd()} ${currentCitations.map((citation) => `[${citation}]`).join(' ')}`;
        }
        return line;
    }).join('\n');
}

function getUncitedSummarySources(note, sources) {
    const cited = new Set([...String(note || '').matchAll(/\[C(\d+)\]/g)].map((match) => `C${match[1]}`));
    return sources.filter((source) => !cited.has(source.citation));
}

function buildSummaryBatchRepairMessages(messages, note, sources) {
    const requiredCitations = sources.map((source) => `[${source.citation}]`).join(', ');
    return [
        ...messages,
        { role: 'assistant', content: note },
        {
            role: 'user',
            content: `Correggi la risposta: scrivi esattamente un punto elenco per ciascuna fonte, una volta sola. Le citazioni obbligatorie sono ${requiredCitations}, una diversa per ogni passaggio. Ogni punto deve iniziare con la sua citazione tra parentesi quadre, per esempio "- [C1] Fatto del capitolo." Usa solo fatti già presenti nella risposta precedente o nei passaggi, senza inventare. Restituisci soltanto i punti elenco.`
        }
    ];
}

function buildSummaryBatchMessages(bookTitle, sources, batchNumber, batchCount, totalSourceCount = batchCount * 3) {
    const maxWordsPerChapter = Math.max(20, Math.floor(480 / totalSourceCount));
    const passages = sources.map((source) =>
        `[${source.citation}] ${source.book_title} | Capitolo ${source.chapter_number}\n${source.prompt_excerpt}`
    ).join('\n\n');

    return [
        {
            role: 'system',
            content: `Riassumi in italiano il gruppo ${batchNumber} di ${batchCount} del libro "${bookTitle}". Scrivi esattamente un punto elenco per ciascuna delle ${sources.length} fonti. Ogni punto deve iniziare con la citazione della propria fonte (per esempio "- [C1]") e descrivere in parole tue il principale sviluppo narrativo di quel capitolo, in massimo ${maxWordsPerChapter} parole. Usa esclusivamente i passaggi della fonte associata: non usare conoscenze sulla serie o sugli altri libri. Riporta nomi propri, identità e relazioni solo se compaiono esplicitamente in quel passaggio; se non sono chiari, non indovinarli. Non omettere fonti, non usare la citazione di un capitolo per fatti di un altro, non copiare il testo e non inventare collegamenti o fatti esterni.`
        },
        {
            role: 'user',
            content: `Passaggi del gruppo ${batchNumber} di ${batchCount}:\n\n${passages}`
        }
    ];
}

function combineSummaryNotes(notes) {
    return notes.filter(Boolean).join('\n\n');
}

function getSummaryBookData(database, book) {
    if (!book) return null;

    const chapters = database.prepare(`
        SELECT
            ch.id AS chunk_id,
            ch.id AS chapter_id,
            ch.text,
            ch.chapter_number,
            0 AS chunk_number,
            ch.title AS chapter_title,
            ch.words AS chapter_words,
            b.title AS book_title,
            b.authors
        FROM extracted_chapters ch
        JOIN extracted_books eb ON eb.id = ch.extracted_book_id
        JOIN books b ON b.id = eb.book_id
        WHERE eb.id = ?
        ORDER BY ch.chapter_number, ch.id
    `).all(book.extracted_book_id);

    const narrativeChunks = chapters.filter(isNarrativeChunk);
    if (!narrativeChunks.length) return null;

    return {
        book: {
            id: book.book_id,
            calibre_id: book.calibre_id,
            title: book.book_title,
            authors: book.authors
        },
        chunks: selectChapterRepresentativeChunks(narrativeChunks)
    };
}

function getBookSummaryChunks(database, query) {
    const normalizedQuery = ` ${normalizeTitle(query)} `;
    const books = database.prepare(`
        SELECT
            b.id AS book_id,
            b.calibre_id,
            b.title AS book_title,
            b.authors,
            eb.id AS extracted_book_id,
            COUNT(ch.id) AS chapter_count
        FROM books b
        JOIN extracted_books eb ON eb.book_id = b.id
        JOIN extracted_chapters ch ON ch.extracted_book_id = eb.id
        GROUP BY eb.id
        ORDER BY LENGTH(b.title) DESC, COUNT(ch.id) DESC, MAX(eb.extracted_at) DESC
    `).all();
    const book = books.find((candidate) => {
        const normalizedTitle = normalizeTitle(candidate.book_title);
        return normalizedTitle && normalizedQuery.includes(` ${normalizedTitle} `);
    });
    return getSummaryBookData(database, book);
}

function getBookSummaryChunksByCalibreId(database, calibreBookId) {
    const book = database.prepare(`
        SELECT
            b.id AS book_id,
            b.calibre_id,
            b.title AS book_title,
            b.authors,
            eb.id AS extracted_book_id
        FROM books b
        JOIN extracted_books eb ON eb.book_id = b.id
        JOIN extracted_chapters ch ON ch.extracted_book_id = eb.id
        WHERE b.calibre_id = ?
        GROUP BY eb.id
        ORDER BY MAX(eb.extracted_at) DESC
        LIMIT 1
    `).get(Number(calibreBookId));

    return getSummaryBookData(database, book);
}

module.exports = {
    getBookSummaryChunks,
    isBookSummaryRequest,
    isNarrativeChunk,
    selectChapterRepresentativeChunks,
    splitSummarySources,
    restoreSummaryCitations,
    normalizeSummaryNoteCitations,
    getUncitedSummarySources,
    buildSummaryBatchRepairMessages,
    buildSummaryBatchMessages,
    combineSummaryNotes,
    getBookSummaryChunksByCalibreId
};