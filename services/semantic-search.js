function getDisplayChapterTitle(title, chapterNumber) {
    const chapterTitle = String(title || '').trim();
    if (chapterTitle && !/\.(?:html?|xhtml)$/i.test(chapterTitle)) return chapterTitle;

    const number = Number(chapterNumber);
    return Number.isFinite(number) && number > 0 ? `Capitolo ${number}` : 'Capitolo';
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

module.exports = { groupSearchResults };