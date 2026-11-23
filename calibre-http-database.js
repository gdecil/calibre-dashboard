const {
    fetchBooksFromCalibre,
    fetchCalibreBookMetadata,
    fetchCalibreBookCount
} = require('./services/calibre-opds');

let books = null;
let totalBooks = null;
const detailsRequests = new Map();

function mapBook(book) {
    return {
        id: book.uuid,
        calibre_id: book.id,
        title: book.title,
        authors: book.authors,
        tags: book.tags,
        publisher: book.publisher,
        published_date: book.published_date,
        isbn: book.isbn,
        description: book.description,
        page_count: book.page_count,
        language: book.language,
        cover_url: book.cover_url,
        last_modified: book.last_modified,
        read_at: book.read_at,
        reading_order: book.reading_order,
        status: book.status,
        rating: book.rating,
        identifiers: book.identifiers
    };
}

async function refreshBooks() {
    const [fetchedBooks, fetchedTotalBooks] = await Promise.all([
        fetchBooksFromCalibre(),
        fetchCalibreBookCount()
    ]);
    books = fetchedBooks.map(mapBook);
    totalBooks = fetchedTotalBooks;
    detailsRequests.clear();
    return books;
}

async function getBookDetails(bookId) {
    const id = String(bookId || '');
    if (!/^\d+$/.test(id)) throw new Error('ID libro Calibre non valido');

    const book = getReadBooks().find(item => String(item.calibre_id) === id);
    if (!book) throw new Error('Libro non trovato nel catalogo Calibre');

    if (!detailsRequests.has(id)) {
        const request = fetchCalibreBookMetadata(id)
            .then(metadata => {
                const description = metadata?.comments ?? metadata?.description ?? null;
                const rating = Number(metadata?.rating);
                const identifiers = metadata?.identifiers || {};
                const isbn = identifiers.isbn ?? identifiers.ISBN ?? null;

                book.description ||= typeof description === 'string' && description.trim()
                    ? description
                    : null;
                book.publisher ||= typeof metadata?.publisher === 'string' && metadata.publisher.trim()
                    ? metadata.publisher
                    : null;
                if (!Number.isFinite(book.rating) || book.rating <= 0) {
                    book.rating = Number.isFinite(rating) && rating > 0
                        ? Math.round(rating / 2)
                        : null;
                }
                book.isbn ||= typeof isbn === 'string' && isbn.trim() ? isbn : null;

                return {
                    description: book.description,
                    publisher: book.publisher,
                    rating: book.rating,
                    isbn: book.isbn
                };
            })
            .catch(error => {
                detailsRequests.delete(id);
                throw error;
            });
        detailsRequests.set(id, request);
    }

    return detailsRequests.get(id);
}

async function getBookDescription(bookId) {
    const details = await getBookDetails(bookId);
    return details.description;
}

function getReadBooks() {
    if (!books) throw new Error('I libri Calibre non sono ancora stati caricati');
    return books;
}

function countValues(values) {
    const counts = new Map();
    for (const value of values) {
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
}

function getStats() {
    const readBooks = getReadBooks();
    const authors = countValues(readBooks.flatMap(book => book.authors || []));
    const genres = countValues(readBooks.flatMap(book => book.tags || []));
    const years = countValues(readBooks
        .map(book => book.read_at && new Date(book.read_at).getFullYear())
        .filter(year => Number.isInteger(year)));
    const languages = countValues(readBooks.map(book => book.language));
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const book of readBooks) {
        if (Number.isInteger(book.rating) && book.rating >= 1 && book.rating <= 5) {
            ratingDistribution[book.rating]++;
        }
    }

    return {
        total_books: totalBooks,
        read_books: readBooks.length,
        percentage_read: totalBooks ? Math.round((readBooks.length / totalBooks) * 100) : 0,
        top_authors: authors.map(([author, count]) => [author, count, null]),
        top_genres: genres.map(([genre, count]) => [genre, count]),
        rating_distribution: ratingDistribution,
        total_authors: authors.length,
        year_distribution: years.map(([year, count]) => [year, count]),
        language_distribution: languages.slice(0, 10).map(([language, count]) => [language, count])
    };
}

function getAdvancedStats() {
    const stats = getStats();
    return {
        rating_distribution: Object.entries(stats.rating_distribution)
            .map(([rating, count]) => [Number(rating), count]),
        year_distribution: stats.year_distribution,
        language_distribution: stats.language_distribution,
        top_genres: stats.top_genres.slice(0, 15)
    };
}

function searchBooks(query) {
    const term = String(query || '').toLocaleLowerCase();
    return getReadBooks()
        .filter(book => [book.title, ...(book.authors || [])]
            .some(value => String(value || '').toLocaleLowerCase().includes(term)))
        .slice(0, 100);
}

async function initializeDatabase() {
    const loadedBooks = await refreshBooks();
    console.log(`✅ Connesso al server Calibre via HTTP (${loadedBooks.length} libri letti)`);
    return true;
}

module.exports = {
    initializeDatabase,
    refreshBooks,
    getReadBooks,
    getBookDetails,
    getBookDescription,
    getStats,
    getAdvancedStats,
    searchBooks,
    getCoverPath: () => null
};
