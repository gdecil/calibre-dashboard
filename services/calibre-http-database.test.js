const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { fetchBooksFromCalibre, parseReadBooksFeed } = require('./calibre-opds');

const booksFeed = fs.readFileSync(
    path.join(__dirname, '..', 'tmp', 'test', 'test-calibre-response.xml'),
    'utf8'
);

test('parses book metadata from an OPDS feed', async () => {
    const books = await parseReadBooksFeed(booksFeed);
    const book = books.find(item => item.reading_order === 1);

    assert.deepEqual({
        title: book.title,
        authors: book.authors,
        reading_order: book.reading_order,
        read_at: book.read_at,
        cover_url: book.cover_url
    }, {
        title: '(il professionista 01) - RAID A KOUROU',
        authors: ['Stefano DiMarino & Gunn Stephen'],
        reading_order: 1,
        read_at: '2023-06-19',
        cover_url: '/cover/get/cover/23713/biblioteca'
    });
});

test('follows feed-level next links and includes books from every page', async () => {
    const originalUrl = process.env.CALIBRE_URL;
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'application/atom+xml');

        if (request.url.startsWith('/opds/category/')) {
            response.end(`
                <feed xmlns="http://www.w3.org/2005/Atom">
                  <link rel="next" href="/read/page/2"/>
                  <entry>
                    <title>Primo libro</title>
                    <id>urn:uuid:first-book</id>
                    <content type="text">Terminato: 1 gennaio 2024</content>
                  </entry>
                </feed>
            `);
        } else if (request.url === '/read/page/2') {
            response.end(`
                <feed xmlns="http://www.w3.org/2005/Atom">
                  <entry>
                    <title>Secondo libro</title>
                    <id>urn:uuid:second-book</id>
                    <content type="text">Terminato: 2 gennaio 2024</content>
                  </entry>
                </feed>
            `);
        } else {
            response.statusCode = 404;
            response.end();
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        process.env.CALIBRE_URL = `http://127.0.0.1:${port}`;
        const books = await fetchBooksFromCalibre();

        assert.equal(books.length, 2);
        assert.deepEqual(books.map(book => book.title), ['Primo libro', 'Secondo libro']);
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (originalUrl === undefined) delete process.env.CALIBRE_URL;
        else process.env.CALIBRE_URL = originalUrl;
    }
});

test('loads books directly over HTTP without a PostgreSQL URL', async () => {
    const originalEnvironment = {
        CALIBRE_URL: process.env.CALIBRE_URL,
        CALIBRE_USERNAME: process.env.CALIBRE_USERNAME,
        CALIBRE_PASSWORD: process.env.CALIBRE_PASSWORD,
        CALIBRE_DB_PATH: process.env.CALIBRE_DB_PATH,
        DATABASE_URL: process.env.DATABASE_URL
    };
    const catalog = `
        <feed>
          <entry>
            <title>Finito</title>
            <link rel="http://opds-spec.org/acquisition" href="/read"/>
          </entry>
        </feed>
    `;
    let metadataRequests = 0;
    const server = http.createServer((request, response) => {
        response.setHeader('Connection', 'close');
        response.setHeader('Content-Type', 'application/atom+xml');
        const authorization = request.headers.authorization;
        if (!authorization) {
            response.statusCode = 401;
            response.setHeader(
                'WWW-Authenticate',
                'Digest realm="calibre", nonce="test-nonce", algorithm=MD5, qop="auth"'
            );
            response.end();
            return;
        }

        const parameters = Object.fromEntries(
            [...authorization.matchAll(/([a-z]+)="?([^", ]+)"?/g)]
                .map(([, key, value]) => [key, value])
        );
        const md5 = value => crypto.createHash('md5').update(value).digest('hex');
        const ha1 = md5('test-reader:calibre:test-secret');
        const ha2 = md5(`GET:${request.url}`);
        const expectedResponse = md5(
            `${ha1}:test-nonce:${parameters.nc}:${parameters.cnonce}:auth:${ha2}`
        );
        if (
            !authorization.startsWith('Digest ')
            || parameters.username !== 'test-reader'
            || parameters.response !== expectedResponse
        ) {
            response.statusCode = 401;
            response.end();
            return;
        }

        if (request.url.startsWith('/ajax/search?')) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ total_num: 10604 }));
        } else if (request.url.startsWith('/opds/category/')) {
            response.end(catalog);
        } else if (request.url === '/read') {
            response.end(booksFeed);
        } else if (request.url.startsWith('/interface-data/book-metadata/')) {
            metadataRequests++;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({
                comments: '<p>Descrizione di prova</p>',
                publisher: metadataRequests === 1 ? 'Editore di prova' : 'Editore aggiornato',
                rating: 8,
                identifiers: { isbn: '1234567890123' }
            }));
        } else {
            response.statusCode = 404;
            response.end();
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        process.env.CALIBRE_URL = `http://127.0.0.1:${port}`;
        process.env.CALIBRE_USERNAME = 'test-reader';
        process.env.CALIBRE_PASSWORD = 'test-secret';
        delete process.env.CALIBRE_DB_PATH;
        delete process.env.DATABASE_URL;
        delete require.cache[require.resolve('../database')];

        const database = require('../database');
        assert.equal(await database.initializeDatabase(), true);

        const books = await database.getReadBooks();
        assert.ok(books.length > 0);
        assert.ok(books[0].id);
        const stats = await database.getStats();
        assert.equal(stats.total_books, 10604);
        assert.equal(stats.read_books, books.length);
        assert.equal(stats.percentage_read, Math.round((books.length / 10604) * 100));
        const latestReadByAuthor = new Map();
        for (const book of books) {
            if (!book.read_at) continue;
            for (const author of book.authors) {
                const currentDate = latestReadByAuthor.get(author);
                if (!currentDate || new Date(book.read_at) > new Date(currentDate)) {
                    latestReadByAuthor.set(author, book.read_at);
                }
            }
        }
        assert.ok(latestReadByAuthor.size > 0);
        for (const [author, , lastReadDate] of stats.top_authors) {
            assert.equal(lastReadDate, latestReadByAuthor.get(author) || null);
        }
        const target = books.find(book => book.calibre_id === '23714');
        assert.ok(target);
        assert.deepEqual(await database.getBookDetails(target.calibre_id), {
            description: '<p>Descrizione di prova</p>',
            publisher: 'Editore di prova',
            rating: 4,
            isbn: '1234567890123'
        });
        assert.equal(metadataRequests, 1);
        const refreshedDetails = await database.getBookDetails(target.calibre_id);
        assert.equal(refreshedDetails.publisher, 'Editore aggiornato');
        assert.equal(metadataRequests, 2);
        assert.equal(await database.getBookDescription(target.calibre_id), '<p>Descrizione di prova</p>');
        assert.equal(target.publisher, 'Editore aggiornato');
        assert.equal(target.rating, 4);
        assert.equal(target.isbn, '1234567890123');
        assert.equal(metadataRequests, 3);
    } finally {
        await new Promise(resolve => server.close(resolve));
        delete require.cache[require.resolve('../database')];
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
