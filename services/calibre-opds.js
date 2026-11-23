const axios = require('axios');
const crypto = require('node:crypto');
const { parseStringPromise } = require('xml2js');

const FINISHED_BOOKS_CATEGORY = '/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca';
const nonceCounts = new Map();

function md5(value) {
    return crypto.createHash('md5').update(value).digest('hex');
}

function parseDigestChallenge(header) {
    const match = header?.match(/^\s*Digest\s+(.+)$/i);
    if (!match) return null;

    const values = {};
    for (const parameter of match[1].matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:\\.|[^"])*)"|([^,\s]+))/gi)) {
        values[parameter[1].toLowerCase()] = (parameter[2] ?? parameter[3]).replace(/\\(.)/g, '$1');
    }

    if (!values.realm || !values.nonce) return null;
    return values;
}

function quoteDigestValue(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function createDigestAuthorization(url, method, challenge) {
    const username = process.env.CALIBRE_USERNAME || 'gdecil';
    const password = process.env.CALIBRE_PASSWORD || '';
    const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
    if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') {
        throw new Error(`Algoritmo Digest Calibre non supportato: ${algorithm}`);
    }

    const qopOptions = (challenge.qop || '').split(',').map(value => value.trim()).filter(Boolean);
    if (qopOptions.length && !qopOptions.includes('auth')) {
        throw new Error('Il server Calibre non supporta il livello Digest richiesto');
    }

    const nonceCount = (nonceCounts.get(challenge.nonce) || 0) + 1;
    nonceCounts.set(challenge.nonce, nonceCount);
    const nc = nonceCount.toString(16).padStart(8, '0');
    const cnonce = crypto.randomBytes(16).toString('hex');
    const uri = `${url.pathname}${url.search}`;
    const baseHa1 = md5(`${username}:${challenge.realm}:${password}`);
    const ha1 = algorithm === 'MD5-SESS'
        ? md5(`${baseHa1}:${challenge.nonce}:${cnonce}`)
        : baseHa1;
    const ha2 = md5(`${method}:${uri}`);
    const response = qopOptions.length
        ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
        : md5(`${ha1}:${challenge.nonce}:${ha2}`);

    const parts = [
        `username=${quoteDigestValue(username)}`,
        `realm=${quoteDigestValue(challenge.realm)}`,
        `nonce=${quoteDigestValue(challenge.nonce)}`,
        `uri=${quoteDigestValue(uri)}`,
        `response=${quoteDigestValue(response)}`,
        `algorithm=${algorithm}`
    ];
    if (qopOptions.length) {
        parts.push('qop=auth', `nc=${nc}`, `cnonce=${quoteDigestValue(cnonce)}`);
    }
    if (challenge.opaque) parts.push(`opaque=${quoteDigestValue(challenge.opaque)}`);
    return `Digest ${parts.join(', ')}`;
}

async function getCalibreResponse(urlValue, config = {}) {
    const url = new URL(urlValue);
    try {
        return await axios.get(url.href, config);
    } catch (error) {
        if (error.response?.status !== 401) throw error;

        const challenge = parseDigestChallenge(error.response.headers['www-authenticate']);
        if (!challenge) throw error;
        if (typeof error.response.data?.resume === 'function') error.response.data.resume();

        const authorization = createDigestAuthorization(url, 'GET', challenge);
        return axios.get(url.href, {
            ...config,
            headers: { ...config.headers, Authorization: authorization }
        });
    }
}

function getNodeText(node) {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(getNodeText).join('\n');
    if (!node || typeof node !== 'object') return '';

    return Object.entries(node)
        .filter(([key]) => key !== '$')
        .map(([, value]) => getNodeText(value))
        .filter(Boolean)
        .join('\n');
}

function getLinks(entry) {
    const links = entry?.link || [];
    return Array.isArray(links) ? links : [links];
}

function getLink(entry, relation) {
    return getLinks(entry).find(link => link?.$?.rel === relation)?.$?.href || null;
}

function parseReadDate(content) {
    const match = content.match(/terminato:\s*(\d{1,2})\s+([a-zà-ù]+)\s+(\d{4})/i);
    if (!match) return null;

    const months = {
        gen: '01', gennaio: '01',
        feb: '02', febbraio: '02',
        mar: '03', marzo: '03',
        apr: '04', aprile: '04',
        mag: '05', maggio: '05',
        giu: '06', giugno: '06',
        lug: '07', luglio: '07',
        ago: '08', agosto: '08',
        set: '09', settembre: '09',
        ott: '10', ottobre: '10',
        nov: '11', novembre: '11',
        dic: '12', dicembre: '12'
    };
    const month = months[match[2].toLocaleLowerCase('it')];
    if (!month) return null;
    return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
}

function parseBook(entry) {
    const content = getNodeText(entry.content);
    const id = entry.id?.[0]?.replace(/^urn:uuid:/, '') || null;
    const authors = (entry.author || [])
        .map(author => author.name?.[0])
        .filter(Boolean);
    const tagsMatch = content.match(/TAG:\s*([^\r\n<]+)/i);
    const publisherMatch = content.match(/Editore:\s*([^\r\n<]+)/i);
    const languageMatch = content.match(/Lingua:\s*([^\r\n<]+)/i);
    const ratingMatch = content.match(/Valutazione:\s*(\d+)/i);
    const pageCountMatch = content.match(/npages:\s*(\d+)/i);
    const readingOrderMatch = content.match(/OrdLett:\s*(\d+)/i);
    const coverHref = getLink(entry, 'http://opds-spec.org/cover')
        || getLink(entry, 'http://opds-spec.org/image');

    return {
        uuid: id,
        title: entry.title?.[0] || 'Sconosciuto',
        authors: authors.length ? authors : ['Sconosciuto'],
        tags: tagsMatch ? tagsMatch[1].split(',').map(tag => tag.trim()).filter(Boolean) : [],
        publisher: publisherMatch?.[1]?.trim() || null,
        published_date: entry['dc:date']?.[0] || entry.published?.[0] || null,
        isbn: null,
        description: null,
        page_count: pageCountMatch ? Number.parseInt(pageCountMatch[1], 10) : null,
        language: languageMatch?.[1]?.trim() || null,
        cover_url: coverHref ? `/cover/${coverHref.replace(/^\/+/, '')}` : null,
        last_modified: entry.updated?.[0] || null,
        read_at: parseReadDate(content),
        reading_order: readingOrderMatch ? Number.parseInt(readingOrderMatch[1], 10) : null,
        status: 'Finito',
        rating: ratingMatch ? Number.parseInt(ratingMatch[1], 10) : null,
        identifiers: {},
        user_metadata: {
            '#read': { value: true },
            '#rating': { value: ratingMatch ? Number.parseInt(ratingMatch[1], 10) : null }
        }
    };
}

async function parseReadBooksFeed(xml) {
    const result = await parseStringPromise(xml);
    const entries = result.feed?.entry || [];
    return entries.map(parseBook);
}

async function fetchBooksFromCalibre() {
    const serverUrl = process.env.CALIBRE_URL || 'http://localhost:8090';
    const baseUrl = new URL(serverUrl);
    baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');
    const config = {
        timeout: 30000,
        headers: { Accept: 'application/atom+xml' }
    };
    const visited = new Set();

    async function fetchFeed(href) {
        const url = new URL(href, baseUrl);
        if (url.origin !== baseUrl.origin) {
            throw new Error('Il server Calibre ha restituito un link esterno al proprio host');
        }
        if (visited.has(url.href)) return null;
        visited.add(url.href);
        return (await getCalibreResponse(url.href, config)).data;
    }

    const catalogXml = await fetchFeed(FINISHED_BOOKS_CATEGORY);
    if (!catalogXml) throw new Error('Feed OPDS Calibre vuoto');
    const catalog = await parseStringPromise(catalogXml);
    const catalogEntries = catalog.feed?.entry || [];
    const category = catalogEntries.find(entry => entry.title?.[0] === 'Finito');
    let nextHref = getLink(category, 'http://opds-spec.org/acquisition');
    const books = [];

    if (!nextHref && catalogEntries.some(entry => entry.id?.[0]?.startsWith('urn:uuid:'))) {
        books.push(...await parseReadBooksFeed(catalogXml));
        nextHref = getLinks(catalog.feed).find(link => link?.$?.rel === 'next')?.$?.href || null;
    } else if (!nextHref) {
        throw new Error('Il feed OPDS Calibre non contiene la categoria "Finito"');
    }

    while (nextHref) {
        const xml = await fetchFeed(nextHref);
        if (!xml) break;
        books.push(...await parseReadBooksFeed(xml));
        const feed = await parseStringPromise(xml);
        nextHref = getLinks(feed.feed).find(link => link?.$?.rel === 'next')?.$?.href || null;
    }

    return books;
}

module.exports = {
    fetchBooksFromCalibre,
    parseReadBooksFeed,
    getCalibreResponse
};
