const axios = require('axios');
require('dotenv').config();

class GoogleBooksAPI {
    constructor() {
        this.baseUrl = 'https://www.googleapis.com/books/v1/volumes';
        this.apiKey = process.env.GOOGLE_BOOKS_API_KEY || '';
        this.rateLimit = 1000; // ms between requests to avoid rate limiting
        this.lastRequestTime = 0;
        this.quotaExceeded = false; // Flag to skip requests when quota is exceeded
    }

    async _makeRequest(url, params = {}) {
        // Skip if quota already exceeded
        if (this.quotaExceeded) {
            console.log('Skipping Google Books API request - quota exceeded');
            return null;
        }

        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimit) {
            await new Promise(resolve => setTimeout(resolve, this.rateLimit - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();

        let retries = 0;
        const maxRetries = 3;

        while (retries <= maxRetries) {
            try {
                const response = await axios.get(url, {
                    params: { ...params, key: this.apiKey },
                    timeout: 10000
                });
                return response.data;
            } catch (error) {
                console.error(`Google Books API error (attempt ${retries + 1}/${maxRetries + 1}):`, error.message);
                
                if (error.response) {
                    console.error('Status:', error.response.status);
                    
                    // Handle 429 (quota exceeded) with exponential backoff
                    if (error.response.status === 429) {
                        this.quotaExceeded = true; // Set flag to skip future requests
                        if (retries < maxRetries) {
                            const backoffMs = Math.pow(2, retries) * 1000; // 1s, 2s, 4s
                            console.log(`Quota exceeded. Retrying in ${backoffMs}ms...`);
                            await new Promise(resolve => setTimeout(resolve, backoffMs));
                            retries++;
                            continue;
                        } else {
                            console.error('Max retries reached for quota exceeded. Giving up.');
                            return null;
                        }
                    }
                    
                    // For other errors, don't retry
                    console.error('Data:', error.response.data);
                    return null;
                }
                
                // Network or other errors
                if (retries < maxRetries) {
                    retries++;
                    continue;
                }
                
                return null;
            }
        }
        
        return null;
    }

    /**
     * Search books by query
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} Array of book objects
     */
    async searchBooks(query, options = {}) {
        const params = {
            q: query,
            maxResults: options.maxResults || 40,
            startIndex: options.startIndex || 0,
            printType: options.printType || 'books',
            orderBy: options.orderBy || 'relevance',
            langRestrict: options.langRestrict || 'it,en'
        };

        const data = await this._makeRequest(this.baseUrl, params);
        return data?.items || [];
    }

    /**
     * Get book by ISBN
     * @param {string} isbn - ISBN number
     * @returns {Promise<Object|null>} Book object or null
     */
    async getBookByISBN(isbn) {
        const query = `isbn:${isbn}`;
        const data = await this._makeRequest(this.baseUrl, {
            q: query,
            maxResults: 1
        });
        return data?.items?.[0] || null;
    }

    /**
     * Get book by title and author
     * @param {string} title - Book title
     * @param {string} author - Book author
     * @returns {Promise<Object|null>} Book object or null
     */
    async getBookByTitleAuthor(title, author) {
        const query = `intitle:"${title}" inauthor:"${author}"`;
        const data = await this._makeRequest(this.baseUrl, {
            q: query,
            maxResults: 5
        });
        return data?.items || [];
    }

    /**
     * Extract standardized book data from Google Books response
     * @param {Object} bookItem - Google Books API item
     * @returns {Object} Standardized book data
     */
    extractBookData(bookItem) {
        const volumeInfo = bookItem.volumeInfo || {};
        const saleInfo = bookItem.saleInfo || {};
        const searchInfo = bookItem.searchInfo || {};

        return {
            source: 'google_books',
            googleBooksId: bookItem.id,
            title: volumeInfo.title || 'Unknown',
            subtitle: volumeInfo.subtitle || '',
            authors: volumeInfo.authors || [],
            publisher: volumeInfo.publisher || '',
            publishedDate: volumeInfo.publishedDate || '',
            description: volumeInfo.description || '',
            industryIdentifiers: volumeInfo.industryIdentifiers || [],
            pageCount: volumeInfo.pageCount,
            printType: volumeInfo.printType || '',
            categories: volumeInfo.categories || [],
            averageRating: volumeInfo.averageRating,
            ratingsCount: volumeInfo.ratingsCount,
            maturityRating: volumeInfo.maturityRating || '',
            language: volumeInfo.language || '',
            previewLink: volumeInfo.previewLink || '',
            infoLink: volumeInfo.infoLink || '',
            canonicalVolumeLink: volumeInfo.canonicalVolumeLink || '',
            country: saleInfo.country || '',
            saleability: saleInfo.saleability || '',
            isEbook: saleInfo.isEbook || false,
            listPrice: saleInfo.listPrice,
            retailPrice: saleInfo.retailPrice,
            buyLink: saleInfo.buyLink || '',
            thumbnail: this._getThumbnail(volumeInfo.imageLinks),
            smallThumbnail: this._getSmallThumbnail(volumeInfo.imageLinks),
            textSnippet: searchInfo?.textSnippet || ''
        };
    }

    _getThumbnail(imageLinks) {
        if (!imageLinks) return '';
        return imageLinks.thumbnail?.replace('http://', 'https://') ||
               imageLinks.smallThumbnail?.replace('http://', 'https://') ||
               '';
    }

    _getSmallThumbnail(imageLinks) {
        if (!imageLinks) return '';
        return imageLinks.smallThumbnail?.replace('http://', 'https://') || '';
    }
}

module.exports = GoogleBooksAPI;