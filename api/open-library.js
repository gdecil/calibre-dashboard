const axios = require('axios');
require('dotenv').config();

class OpenLibraryAPI {
    constructor() {
        this.baseUrl = 'https://openlibrary.org';
        this.rateLimit = 500; // ms between requests
        this.lastRequestTime = 0;
    }

    async _makeRequest(url, params = {}) {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimit) {
            await new Promise(resolve => setTimeout(resolve, this.rateLimit - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();

        try {
            const response = await axios.get(url, {
                params: params,
                timeout: 15000
            });
            return response.data;
        } catch (error) {
            console.error('Open Library API error:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
            }
            return null;
        }
    }

    /**
     * Search books by query
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    async searchBooks(query, options = {}) {
        const params = {
            q: query,
            limit: options.limit || 10,
            offset: options.offset || 0,
            fields: 'key,title,author_name,first_publish_year,publisher,isbn,cover_i,edition_key,number_of_pages_key,subject,author_key,language',
            lang: options.lang || 'it,en'
        };

        return await this._makeRequest(`${this.baseUrl}/search.json`, params);
    }

    /**
     * Get book by ISBN
     * @param {string} isbn - ISBN number
     * @returns {Promise<Object|null>} Book data or null
     */
    async getBookByISBN(isbn) {
        return await this._makeRequest(`${this.baseUrl}/isbn/${isbn}.json`);
    }

    /**
     * Get book by Open Library ID
     * @param {string} olid - Open Library ID
     * @returns {Promise<Object|null>} Book data or null
     */
    async getBookByID(olid) {
        return await this._makeRequest(`${this.baseUrl}/works/${olid}.json`);
    }

    /**
     * Get book covers
     * @param {number} coverId - Cover ID
     * @param {string} size - Size (S, M, L)
     * @returns {string} Cover URL
     */
    getCoverUrl(coverId, size = 'M') {
        if (!coverId) return '';
        return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
    }

    /**
     * Extract standardized book data from Open Library response
     * @param {Object} bookData - Open Library book data
     * @returns {Object} Standardized book data
     */
    extractBookData(bookData) {
        if (!bookData) return null;

        // Handle search result format vs direct book format
        const isSearchResult = bookData.docs && Array.isArray(bookData.docs);
        const doc = isSearchResult ? bookData.docs[0] : bookData;

        if (!doc) return null;

        return {
            source: 'open_library',
            openLibraryId: doc.key || '',
            title: doc.title || 'Unknown',
            subtitle: doc.subtitle || '',
            authors: doc.author_name || [],
            publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher || '',
            publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
            description: doc.description || '',
            isbn: doc.isbn ? (Array.isArray(doc.isbn) ? doc.isbn[0] : doc.isbn) : '',
            pageCount: doc.number_of_pages_key ? Object.keys(doc.number_of_pages_key)[0] : null,
            languages: doc.language ? (Array.isArray(doc.language) ? doc.language : [doc.language]) : [],
            subjects: doc.subject || [],
            coverId: doc.cover_i,
            coverUrl: doc.cover_i ? this.getCoverUrl(doc.cover_i) : '',
            editionKey: doc.edition_key ? doc.edition_key[0] : '',
            authorKeys: doc.author_key || [],
            ocaid: doc.ocaid || '',
            contributions: doc.contributions || '',
            deweyDecimal: doc.dewey_decimal_class || [],
            lcClassifications: doc.lc_classifications || [],
            ebookAccess: doc.ebook_access || '',
            publicScan: doc.public_scan_b || false,
            lastModified: doc.last_modified?.value || ''
        };
    }

    /**
     * Get author information
     * @param {string} authorKey - Author key
     * @returns {Promise<Object|null>} Author data or null
     */
    async getAuthor(authorKey) {
        return await this._makeRequest(`${this.baseUrl}/authors/${authorKey}.json`);
    }
}

module.exports = OpenLibraryAPI;