function getDisplayChapterTitle(title, chapterNumber) {
    const chapterTitle = String(title || '').trim();
    if (chapterTitle && !/\.(?:html?|xhtml)$/i.test(chapterTitle)) return chapterTitle;

    const number = Number(chapterNumber);
    return Number.isFinite(number) && number > 0 ? `Capitolo ${number}` : 'Capitolo';
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('it')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function selectSearchCandidates(results, { query = '', limit = 10, excludeChunkIds = [] } = {}) {
    const normalizedQuery = ` ${normalizeSearchText(query)} `;
    const requestedBookResults = results.filter((result) => {
        const title = normalizeSearchText(result.payload?.book_title || result.book_title);
        return title && normalizedQuery.includes(` ${title} `);
    });
    const excludedIds = new Set(excludeChunkIds.map(String));
    const candidates = requestedBookResults.length ? requestedBookResults : results;

    return candidates
        .filter((result) => !excludedIds.has(String(result.payload?.chunk_id ?? result.chunk_id ?? result.id)))
        .slice(0, limit);
}

function groupSearchResults(results, { limit = 10, excerptsPerBook = 2 } = {}) {
    const groups = new Map();

    results.forEach((result, index) => {
        const title = String(result.book_title || '').trim().toLocaleLowerCase();
        const authors = Array.isArray(result.authors)
            ? result.authors.join(', ').toLocaleLowerCase()
            : String(result.authors || '').trim().toLocaleLowerCase();
        const chunkId = result.chunk_id ?? result.id ?? index;
        const key = result.book_id !== undefined && result.book_id !== null
            ? `id:${result.book_id}`
            : title
                ? `title:${title}\u0000${authors}`
                : `chunk:${chunkId}`;

        let group = groups.get(key);
        if (!group) {
            group = { ...result, excerpts: [] };
            groups.set(key, group);
        } else if (Number(result.score || 0) > Number(group.score || 0)) {
            const excerpts = group.excerpts;
            Object.assign(group, result, { excerpts });
        }

        if (group.excerpts.length < excerptsPerBook) {
            group.excerpts.push({
                id: result.id,
                chunk_id: result.chunk_id ?? result.id,
                score: result.score,
                chapter_title: getDisplayChapterTitle(result.chapter_title, result.chapter_number),
                text: result.text || ''
            });
        }
    });

    return [...groups.values()]
        .sort((first, second) => Number(second.score || 0) - Number(first.score || 0))
        .slice(0, limit);
}

module.exports = { groupSearchResults, selectSearchCandidates };