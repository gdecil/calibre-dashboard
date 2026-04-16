const GoogleBooksAPI = require('../api/google-books');
const OpenLibraryAPI = require('../api/open-library');
const { pool } = require('../database');

class BookEnricher {
    constructor() {
        this.googleBooks = new GoogleBooksAPI();
        this.openLibrary = new OpenLibraryAPI();
    }

    /**
     * Enrich book data from APIs
     * @param {Object} book - Existing book data
     * @returns {Promise<Object>} Enriched book data
     */
    async enrichBookData(book) {
        try {
            // Try to find book by ISBN first if available
            if (book.isbn) {
                const enrichedData = await this._enrichByISBN(book.isbn);
                if (enrichedData) return enrichedData;
            }

            // Try to find by title and author
            if (book.title && book.authors && book.authors.length > 0) {
                const enrichedData = await this._enrichByTitleAuthor(book.title, book.authors[0]);
                if (enrichedData) return enrichedData;
            }

            // Try to find by title only
            if (book.title) {
                const enrichedData = await this._enrichByTitle(book.title);
                if (enrichedData) return enrichedData;
            }

            return book; // Return original if no enrichment found
        } catch (error) {
            console.error('Error enriching book data:', error.message);
            return book;
        }
    }

    /**
     * Enrich book by ISBN
     * @param {string} isbn - ISBN number
     * @returns {Promise<Object|null>} Enriched book data or null
     */
    async _enrichByISBN(isbn) {
        // Try Google Books first
        let googleData = await this.googleBooks.getBookByISBN(isbn);
        if (googleData) {
            const extracted = this.googleBooks.extractBookData(googleData);
            return this._mergeWithOpenLibrary(extracted, isbn);
        }

        // Try Open Library
        let openLibData = await this.openLibrary.getBookByISBN(isbn);
        if (openLibData) {
            const extracted = this.openLibrary.extractBookData(openLibData);
            return this._mergeWithGoogleBooks(extracted, isbn);
        }

        return null;
    }

    /**
     * Enrich book by title and author
     * @param {string} title - Book title
     * @param {string} author - Book author
     * @returns {Promise<Object|null>} Enriched book data or null
     */
    async _enrichByTitleAuthor(title, author) {
        // Try Google Books first
        let googleResults = await this.googleBooks.getBookByTitleAuthor(title, author);
        if (googleResults && googleResults.length > 0) {
            const extracted = this.googleBooks.extractBookData(googleResults[0]);
            return this._mergeWithOpenLibrary(extracted, null);
        }

        // Try Open Library
        const query = `title:"${title}" AND author:"${author}"`;
        let openLibResults = await this.openLibrary.searchBooks(query);
        if (openLibResults && openLibResults.docs && openLibResults.docs.length > 0) {
            const extracted = this.openLibrary.extractBookData(openLibResults);
            return this._mergeWithGoogleBooks(extracted, null);
        }

        return null;
    }

    /**
     * Enrich book by title only
     * @param {string} title - Book title
     * @returns {Promise<Object|null>} Enriched book data or null
     */
    async _enrichByTitle(title) {
        // Try Google Books
        let googleResults = await this.googleBooks.searchBooks(`intitle:"${title}"`, { maxResults: 3 });
        if (googleResults && googleResults.length > 0) {
            const extracted = this.googleBooks.extractBookData(googleResults[0]);
            return this._mergeWithOpenLibrary(extracted, null);
        }

        // Try Open Library
        let openLibResults = await this.openLibrary.searchBooks(`title:"${title}"`);
        if (openLibResults && openLibResults.docs && openLibResults.docs.length > 0) {
            const extracted = this.openLibrary.extractBookData(openLibResults);
            return this._mergeWithGoogleBooks(extracted, null);
        }

        return null;
    }

    /**
     * Merge Google Books data with Open Library data
     * @param {Object} googleData - Google Books data
     * @param {string|null} isbn - ISBN or null
     * @returns {Promise<Object>} Merged book data
     */
    async _mergeWithOpenLibrary(googleData, isbn) {
        if (isbn) {
            const openLibData = await this.openLibrary.getBookByISBN(isbn);
            if (openLibData) {
                const extractedOpenLib = this.openLibrary.extractBookData(openLibData);
                return this._mergeData(googleData, extractedOpenLib);
            }
        }
        return googleData;
    }

    /**
     * Merge Open Library data with Google Books data
     * @param {Object} openLibData - Open Library data
     * @param {string|null} isbn - ISBN or null
     * @returns {Promise<Object>} Merged book data
     */
    async _mergeWithGoogleBooks(openLibData, isbn) {
        if (isbn) {
            const googleData = await this.googleBooks.getBookByISBN(isbn);
            if (googleData) {
                const extractedGoogle = this.googleBooks.extractBookData(googleData);
                return this._mergeData(extractedGoogle, openLibData);
            }
        }
        return openLibData;
    }

    /**
     * Merge data from two sources
     * @param {Object} primary - Primary data source
     * @param {Object} secondary - Secondary data source
     * @returns {Object} Merged data
     */
    _mergeData(primary, secondary) {
        // Start with primary data
        const merged = { ...primary };

        // Merge fields from secondary, preferring primary where available
        if (secondary.title && !merged.title) merged.title = secondary.title;
        if (secondary.subtitle && !merged.subtitle) merged.subtitle = secondary.subtitle;
        if (secondary.authors && (!merged.authors || merged.authors.length === 0)) merged.authors = secondary.authors;
        if (secondary.publisher && !merged.publisher) merged.publisher = secondary.publisher;
        if (secondary.publishedDate && !merged.publishedDate) merged.publishedDate = secondary.publishedDate;
        if (secondary.description && !merged.description) merged.description = secondary.description;
        if (secondary.pageCount && !merged.pageCount) merged.pageCount = secondary.pageCount;
        if (secondary.categories && (!merged.categories || merged.categories.length === 0)) merged.categories = secondary.categories;
        if (secondary.subjects && (!merged.subjects || merged.subjects.length === 0)) merged.subjects = secondary.subjects;
        if (secondary.thumbnail && !merged.thumbnail) merged.thumbnail = secondary.thumbnail;
        if (secondary.coverUrl && !merged.coverUrl) merged.coverUrl = secondary.coverUrl;

        // Add secondary source info
        merged.sources = [primary.source];
        if (secondary.source && !merged.sources.includes(secondary.source)) {
            merged.sources.push(secondary.source);
        }

        return merged;
    }

    /**
     * Update book in database with enriched data
     * @param {Object} bookId - Book ID
     * @param {Object} enrichedData - Enriched book data
     * @returns {Promise<boolean>} Success status
     */
    async updateBookInDatabase(bookId, enrichedData) {
        try {
            // Map enriched data to database fields
            const updateData = {
                title: enrichedData.title,
                authors: enrichedData.authors,
                publisher: enrichedData.publisher,
                published_date: enrichedData.publishedDate,
                description: enrichedData.description,
                page_count: enrichedData.pageCount,
                categories: enrichedData.categories || enrichedData.subjects,
                language: enrichedData.language,
                isbn: enrichedData.isbn || (enrichedData.industryIdentifiers?.find(id => id.type === 'ISBN_13')?.identifier ||
                                          enrichedData.industryIdentifiers?.find(id => id.type === 'ISBN_10')?.identifier),
                cover_url: enrichedData.thumbnail || enrichedData.coverUrl,
                average_rating: enrichedData.averageRating,
                ratings_count: enrichedData.ratingsCount,
                last_enriched: new Date().toISOString(),
                enrichment_sources: enrichedData.sources?.join(', ') || 'google_books'
            };

            // Update the book in database
            const query = `
                UPDATE read_books
                SET
                    title = $1,
                    authors = $2,
                    publisher = $3,
                    published_date = $4,
                    description = $5,
                    page_count = $6,
                    tags = $7,
                    language = $8,
                    isbn = $9,
                    cover_url = $10,
                    rating = $11,
                    ratings_count = $12,
                    last_enriched = $13,
                    enrichment_sources = $14,
                    updated_at = NOW()
                WHERE id = $15
            `;

            const result = await pool.query(query, [
                updateData.title,
                JSON.stringify(updateData.authors || []),
                updateData.publisher,
                updateData.published_date,
                updateData.description,
                updateData.page_count,
                JSON.stringify(updateData.categories || []),
                updateData.language,
                updateData.isbn,
                updateData.cover_url,
                updateData.average_rating,
                updateData.ratings_count,
                updateData.last_enriched,
                updateData.enrichment_sources,
                bookId
            ]);

            return result.rowCount > 0;
        } catch (error) {
            console.error('Error updating book in database:', error.message);
            return false;
        }
    }

    /**
     * Batch enrich books from database
     * @param {number} limit - Maximum number of books to process
     * @returns {Promise<Object>} Summary of enrichment results
     */
    async batchEnrichBooks(limit = 10) {
        const results = {
            totalProcessed: 0,
            successfullyEnriched: 0,
            failed: 0,
            noChanges: 0
        };

        try {
            // Get books that need enrichment (no recent enrichment or missing key data)
            const query = `
                SELECT id, title, authors, isbn, publisher, published_date
                FROM read_books
                WHERE
                    (last_enriched IS NULL OR last_enriched < NOW() - INTERVAL '30 days')
                    OR isbn IS NULL
                    OR description IS NULL
                    OR cover_url IS NULL
                ORDER BY updated_at ASC
                LIMIT $1
            `;

            const booksToEnrich = await pool.query(query, [limit]);

            for (const book of booksToEnrich.rows) {
                results.totalProcessed++;

                try {
                    const enrichedData = await this.enrichBookData(book);

                    // Check if we actually got new data
                    const hasNewData = this._hasSignificantChanges(book, enrichedData);

                    if (hasNewData) {
                        const success = await this.updateBookInDatabase(book.id, enrichedData);
                        if (success) {
                            results.successfullyEnriched++;
                            console.log(`✅ Enriched book: ${book.title}`);
                        } else {
                            results.failed++;
                            console.log(`❌ Failed to update: ${book.title}`);
                        }
                    } else {
                        results.noChanges++;
                        console.log(`📝 No significant changes for: ${book.title}`);
                    }
                } catch (error) {
                    results.failed++;
                    console.error(`❌ Error enriching book ${book.title}:`, error.message);
                }
            }

            return results;
        } catch (error) {
            console.error('Batch enrichment error:', error.message);
            return { ...results, error: error.message };
        }
    }

    /**
     * Check if enriched data has significant changes
     * @param {Object} original - Original book data
     * @param {Object} enriched - Enriched book data
     * @returns {boolean} True if significant changes found
     */
    _hasSignificantChanges(original, enriched) {
        if (!enriched || original === enriched) return false;
        
        const changes = [];

        if (original.isbn && enriched.isbn && original.isbn !== enriched.isbn) changes.push('isbn');
        if (!original.description && enriched.description) changes.push('description');
        if (!original.cover_url && enriched.thumbnail) changes.push('cover');
        if (original.publisher !== enriched.publisher) changes.push('publisher');
        if (enriched.publishedDate && original.published_date !== enriched.publishedDate) changes.push('date');

        return changes.length > 0;
    }
}

module.exports = BookEnricher;