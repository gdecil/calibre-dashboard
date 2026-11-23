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

// xml2js trasforma <p class="description">...text...</p> in una struttura ad albero
// (l'attributo diviene un attributo di nodo), quindi la descrizione non e reperibile
// con espressioni regolari sul testo: bisogna cercare ricorsivamente l'albero parsed
// e trovare l'elemento <p> con class="description".
function walkParsed(node, visitNode) {
    if (Array.isArray(node)) {
        for (const item of node) walkParsed(item, visitNode);
        return;
    }
    if (!node || typeof node !== 'object') return;
    // visita il nodo stesso per leggere i suoi attributi (es. class="description")
    visitNode(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === '$') continue;
        if (Array.isArray(value)) {
            for (const v of value) walkParsed(v, visitNode);
        } else {
            walkParsed(value, visitNode);
        }
    }
}

function extractDescriptionNode(content) {
    if (typeof content !== 'object') return null;
    let found = null;
    walkParsed(content, candidate => {
        if (found) return;
        const $ = candidate.$ || {};
        if (typeof $['class'] === 'string' && $['class'].toLowerCase().includes('description')) {
            // xml2js trasforma <p class="description">...text...</p> in una struttura ad albero
            // (l'attributo diviene un attributo di nodo), quindi la descrizione non e reperibile
            // con espressioni regolari sul testo: bisogna cercare ricorsivamente l'albero parsed
            // e trovare l'elemento <p> con class="description". getNodeText estrae solo il testo
            // dei nodi (ignorando i tag), poi rimuoviamo l'eventuale prefisso di catalogo
            // incollato all'inizio (es. "EmmeBooks 90", "Version 90566 - ...").
            found = stripCatalogPrefix(getNodeText(candidate));
        }
    });
    return found;
}

// Rimuove un eventuale prefisso di catalogo incollato all'inizio della descrizione.
// Le feed OPDS (es. Scaffaleitalia, Cosmo Argento) incollano codici catalogo/edizione
// davanti al testo reale della sinossi: "EmmeBooks 90Nelle giornate...", "Version 90566 - ...",
// "Abstract", "Scaffaleitalia", "Cosmo Argento n° 280", "Il 14° libro...".
// La regex scambia questi prefissi noti e non-prosaici, lasciando intatto il testo reale.
function stripCatalogPrefix(description) {
    if (typeof description !== 'string') return description || '';
    const PREFIX = /^(Version [0-9]+(?: -.*|\. [^<]*)?|EmmeBooks [0-9]+|EDGT[0-9]+|Abstract|Scaffaleitalia|Cosmo Argento n[0-9°°]+|Ebook gratuito|Ebook [^<]*|Il [0-9]+ libro[^<]*|n[0-9]+°[^<]*|Sardegna[^<]*)[\r\n ]*/i;
    return PREFIX.test(description) ? description.replace(PREFIX, '').trim() : description.trim();
}

function getLinks(entry) {
    const links = entry?.link || [];
    return Array.isArray(links) ? links : [links];
}

function getLink(entry, relation) {
    return getLinks(entry).find(link => link?.$?.rel === relation)?.$?.href || null;
}

// L'ID numerico di Calibre compare nei link di download (es. /get/epub/8966/biblioteca):
//   <link ... rel="http://opds-spec.org/acquisition" href="/get/epub/8966/biblioteca"/>
// ed e' quello che l'endpoint /api/books/:id/summary si aspetta (solo cifre, validato da /^\d+$/:).
// L'UUID OPDS (entry.id) non e' un numero, quindi se serve un ID numerico si estrae da qui.
function getCalibreNumericId(entry) {
    if (entry?.calibre_id) return entry.calibre_id;
    const acquisitionHref = getLink(entry, 'http://opds-spec.org/acquisition');
    if (acquisitionHref) {
        const match = acquisitionHref.match(/\/get\/[a-z]+\/(\d{2,8})\/[a-z]+/i);
        if (match) return match[1];
    }
    return null;
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
    const rawContent = entry.content;
    const content = getNodeText(rawContent);
    const id = entry.id?.[0]?.replace(/^urn:uuid:/, '') || null;
    const calibreNumericId = getCalibreNumericId(entry);
    const authors = (entry.author || [])
        .map(author => author.name?.[0])
        .filter(Boolean);
    const tagsMatch = content.match(/TAG:\s*([^\r\n<]+)/i);
    const publisherMatch = content.match(/Editore:\s*([^\r\n<]+)/i);
    const languageMatch = content.match(/Lingua:\s*([^\r\n<]+)/i);
    const ratingMatch = content.match(/Valutazione:\s*(\d+)/i);
    const pageCountMatch = content.match(/npages:\s*(\d+)/i);
    const readingOrderMatch = content.match(/OrdLett:\s*(\d+)/i);
    const descriptionMatch = extractDescriptionNode(rawContent);
    const coverHref = getLink(entry, 'http://opds-spec.org/cover')
        || getLink(entry, 'http://opds-spec.org/image');

    return {
        uuid: id,
        id: calibreNumericId,
        title: entry.title?.[0] || 'Sconosciuto',
        authors: authors.length ? authors : ['Sconosciuto'],
        tags: tagsMatch ? tagsMatch[1].split(',').map(tag => tag.trim()).filter(Boolean) : [],
        publisher: publisherMatch?.[1]?.trim() || null,
        published_date: entry['dc:date']?.[0] || entry.published?.[0] || null,
        isbn: null,
        description: descriptionMatch || null,
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

async function fetchCalibreBookMetadata(bookId) {
    const id = String(bookId || '');
    if (!/^\d+$/.test(id)) throw new Error('ID libro Calibre non valido');

    const baseUrl = new URL(process.env.CALIBRE_URL || 'http://localhost:8090');
    const metadataUrl = new URL(`/interface-data/book-metadata/${id}`, baseUrl);
    metadataUrl.searchParams.set('library_id', 'biblioteca');
    const response = await getCalibreResponse(metadataUrl.href, {
        timeout: 15000,
        headers: { Accept: 'application/json' }
    });
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
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
    fetchCalibreBookMetadata,
    getCalibreResponse
};
