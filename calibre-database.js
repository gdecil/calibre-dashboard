const Database = require('better-sqlite3');
const path = require('path');

const databasePath = process.env.CALIBRE_DB_PATH;
let database;

function getDatabase() {
    if (!databasePath) {
        throw new Error('CALIBRE_DB_PATH non configurata');
    }

    if (!database) {
        database = new Database(databasePath, { readonly: true, fileMustExist: true });
        database.pragma('busy_timeout = 5000');
    }

    return database;
}

function parseJsonList(value) {
    if (!value) return [];
    return value.split(',').filter(Boolean);
}

const booksQuery = `
    SELECT
        b.id,
        b.title,
        b.pubdate AS published_date,
        b.last_modified,
        b.has_cover,
        GROUP_CONCAT(DISTINCT a.name) AS authors,
        GROUP_CONCAT(DISTINCT t.name) AS tags,
        p.name AS publisher,
        GROUP_CONCAT(DISTINCT lang.lang_code) AS languages,
        GROUP_CONCAT(DISTINCT i.type || ':' || i.val) AS identifiers,
        c.text AS description,
        r.rating,
        c1.value AS status,
        c5.value AS read_at,
        cc7.value AS page_count
    FROM books b
    JOIN books_custom_column_1_link status_link ON b.id = status_link.book
    JOIN custom_column_1 c1 ON status_link.value = c1.id
    LEFT JOIN books_authors_link ba ON b.id = ba.book
    LEFT JOIN authors a ON ba.author = a.id
    LEFT JOIN books_tags_link bt ON b.id = bt.book
    LEFT JOIN tags t ON bt.tag = t.id
    LEFT JOIN books_publishers_link bp ON b.id = bp.book
    LEFT JOIN publishers p ON bp.publisher = p.id
    LEFT JOIN books_languages_link bl ON b.id = bl.book
    LEFT JOIN languages lang ON bl.lang_code = lang.id
    LEFT JOIN identifiers i ON b.id = i.book
    LEFT JOIN comments c ON b.id = c.book
    LEFT JOIN books_ratings_link br ON b.id = br.book
    LEFT JOIN ratings r ON br.rating = r.id
    LEFT JOIN custom_column_5 c5 ON b.id = c5.book
    LEFT JOIN custom_column_7 cc7 ON b.id = cc7.book
    WHERE c1.value = 'Finito'
    GROUP BY b.id
    ORDER BY c5.value DESC, b.title ASC
`;

function mapBook(row) {
    const identifiers = {};
    for (const identifier of parseJsonList(row.identifiers)) {
        const separator = identifier.indexOf(':');
        if (separator > 0) {
            identifiers[identifier.slice(0, separator)] = identifier.slice(separator + 1);
        }
    }

    return {
        id: String(row.id),
        title: row.title,
        authors: parseJsonList(row.authors),
        tags: parseJsonList(row.tags),
        publisher: row.publisher || null,
        published_date: row.published_date || null,
        isbn: identifiers.isbn || null,
        description: row.description || null,
        page_count: row.page_count || null,
        language: parseJsonList(row.languages)[0] || null,
        cover_url: row.has_cover ? `/cover/${row.id}` : null,
        last_modified: row.last_modified || null,
        read_at: row.read_at || null,
        status: row.status,
        rating: row.rating ? Math.round(row.rating / 2) : null,
        identifiers
    };
}

function getReadBooks() {
    return getDatabase().prepare(booksQuery).all().map(mapBook);
}

function getCoverPath(bookId) {
    const book = getDatabase()
        .prepare('SELECT path, has_cover FROM books WHERE id = ?')
        .get(bookId);

    if (!book || !book.has_cover) return null;

    const libraryPath = path.dirname(databasePath);
    const coverPath = path.resolve(libraryPath, book.path, 'cover.jpg');
    const relativePath = path.relative(libraryPath, coverPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
    return coverPath;
}

function getStats() {
    const database = getDatabase();
    const books = getReadBooks();
    const totalBooks = database.prepare('SELECT COUNT(*) AS count FROM books').get().count;
    const authorCounts = new Map();
    const tagCounts = new Map();
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const years = new Map();
    const languages = new Map();

    for (const book of books) {
        for (const author of book.authors) authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
        for (const tag of book.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        if (book.rating >= 1 && book.rating <= 5) ratingDistribution[book.rating]++;
        if (book.read_at) {
            const year = new Date(book.read_at).getFullYear();
            if (!Number.isNaN(year)) years.set(year, (years.get(year) || 0) + 1);
        }
        if (book.language) languages.set(book.language, (languages.get(book.language) || 0) + 1);
    }

    const ranked = (counts, limit = Infinity) => [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, limit);

    return {
        total_books: totalBooks,
        read_books: books.length,
        percentage_read: totalBooks ? Math.round((books.length / totalBooks) * 100) : 0,
        top_authors: ranked(authorCounts).map(([name, count]) => [name, count, null]),
        top_genres: ranked(tagCounts).map(([name, count]) => [name, count]),
        rating_distribution: ratingDistribution,
        total_authors: authorCounts.size,
        year_distribution: ranked(years).map(([year, count]) => [year, count]),
        language_distribution: ranked(languages, 10).map(([language, count]) => [language, count])
    };
}

function getAdvancedStats() {
    const stats = getStats();
    return {
        rating_distribution: Object.entries(stats.rating_distribution).map(([rating, count]) => [Number(rating), count]),
        year_distribution: stats.year_distribution,
        language_distribution: stats.language_distribution,
        top_genres: stats.top_genres.slice(0, 15)
    };
}

function searchBooks(query) {
    const normalizedQuery = String(query || '').toLocaleLowerCase();
    return getReadBooks()
        .filter(book => [book.title, ...book.authors].some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
        .slice(0, 100);
}

function initializeDatabase() {
    const count = getDatabase().prepare('SELECT COUNT(*) AS count FROM books').get().count;
    console.log(`✅ Database Calibre SQLite connesso (${count} libri)`);
    return true;
}

module.exports = {
    initializeDatabase,
    getReadBooks,
    getCoverPath,
    getStats,
    getAdvancedStats,
    searchBooks
};
