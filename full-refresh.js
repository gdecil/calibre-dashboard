const axios = require('axios');
const xml2js = require('xml2js');
const { initializeDatabase, backupDatabase, cleanupOldBackups, pool } = require('./database');
require('dotenv').config();

// URL del server Calibre
const CALIBRE_URL = process.env.CALIBRE_URL || 'http://localhost:8090';

// Credenziali Calibre
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || 'gdecil';
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || '';

const MESI_ITALIANI = {
    'gen': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'mag': 4, 'giu': 5,
    'lug': 6, 'ago': 7, 'set': 8, 'ott': 9, 'nov': 10, 'dic': 11
};

function parseTerminato(content) {
    const match = content.match(/terminato:\s*(\d{1,2})\s+([a-z]{3})\s+(\d{4})/i);
    if (!match) return null;

    const giorno = parseInt(match[1], 10);
    const mese = MESI_ITALIANI[match[2].toLowerCase()];
    const anno = parseInt(match[3], 10);

    if (mese === undefined) return null;
    return new Date(anno, mese, giorno, 12, 0, 0);
}

function parseDescription(content) {
    const match = content.match(/<p[^>]*class="description"[^>]*>([\s\S]*?)<\/p>/i);
    if (!match) return null;
    return match[1].replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

/**
 * PHASE 1: Valida e stabilisci connessioni
 */
async function validateConnections() {
    console.log('🔍 PHASE 1: Validazione connessioni\n');

    // Valida variabili d'ambiente
    if (!process.env.DATABASE_URL) {
        console.error('❌ Variabile d\'ambiente DATABASE_URL non configurata');
        process.exit(1);
    }

    // Test connessione database
    console.log('🔌 Test connessione PostgreSQL...');
    try {
        const res = await pool.query('SELECT 1');
        console.log('✅ Database PostgreSQL: OK');
    } catch (error) {
        console.error('❌ Errore connessione database:', error.message);
        process.exit(1);
    }

    // Test connessione server Calibre
    console.log('🔌 Test connessione server Calibre...');
    try {
        const authConfig = {
            auth: {
                username: CALIBRE_USERNAME,
                password: CALIBRE_PASSWORD
            },
            timeout: 10000,
            headers: { 'Accept': 'application/atom+xml' }
        };
        const response = await axios.get(
            `${CALIBRE_URL}/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca`,
            authConfig
        );
        console.log('✅ Server Calibre: OK');
        return true;
    } catch (error) {
        console.error('❌ Errore connessione server Calibre:', error.message);
        console.error('   URL:', `${CALIBRE_URL}/opds/...`);
        console.error('   Verifica: CALIBRE_URL, CALIBRE_USERNAME, CALIBRE_PASSWORD nel .env');
        process.exit(1);
    }
}

/**
 * PHASE 2: Crea backup preventivo
 */
async function createBackup() {
    console.log('\n📦 PHASE 2: Backup preventivo\n');
    try {
        const result = await backupDatabase();
        if (result) {
            console.log('✅ Backup creato con successo');
        } else {
            console.warn('⚠️  Backup non disponibile (pg_dump non trovato), continuo senza backup...');
        }
    } catch (error) {
        console.warn('⚠️  Backup non disponibile:', error.message);
        console.warn('   ⚠️  Continuo senza backup (rischio: nessun rollback se fallisce)');
    }
}

/**
 * PHASE 3: Trunca tabella read_books
 */
async function truncateTable() {
    console.log('\n🧹 PHASE 3: Svuotamento tabella read_books\n');
    try {
        // Verifica count prima
        const countBefore = await pool.query('SELECT COUNT(*) as count FROM read_books');
        console.log(`   Libri prima: ${countBefore.rows[0].count}`);

        // Truncate
        await pool.query('TRUNCATE TABLE read_books CASCADE');
        console.log('✅ Tabella truncata');

        // Verifica count dopo
        const countAfter = await pool.query('SELECT COUNT(*) as count FROM read_books');
        console.log(`   Libri dopo: ${countAfter.rows[0].count}`);
    } catch (error) {
        console.error('❌ Errore truncate table:', error.message);
        process.exit(1);
    }
}

/**
 * Fetch libri dal server Calibre usando API OPDS
 */
async function fetchBooksFromCalibre() {
    try {
        console.log('📥 Recupero libri da Calibre tramite OPDS...');

        const authConfig = {
            auth: {
                username: CALIBRE_USERNAME,
                password: CALIBRE_PASSWORD
            },
            timeout: 30000,
            headers: { 'Accept': 'application/atom+xml' }
        };

        // Otteniamo direttamente il feed dei libri finiti
        // (l'URL già ritorna il feed dei libri, non una lista di categorie)
        const booksUrl = '/opds/category/23737461747573/49323a23737461747573?library_id=biblioteca';
        const booksResponse = await axios.get(`${CALIBRE_URL}${booksUrl}`, authConfig);

        // Parsing dei libri dal feed OPDS
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(booksResponse.data);

        const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
        console.log(`   Trovati ${entries.length} entry nel feed`);

        const books = [];
        for (const entry of entries) {
            try {
                const book = {
                    uuid: entry.id?.replace('urn:uuid:', '') || null,
                    title: entry.title || 'Sconosciuto',
                    authors: entry.author?.name || 'Sconosciuto',
                    pubdate: entry['dc:date'] || null,
                    last_modified: entry.updated || null,
                    read_at: null,
                    description: null,
                    cover_url: null,
                    user_metadata: {
                        '#read': { value: true },
                        '#rating': { value: null }
                    },
                    tags: [],
                    publisher: null,
                    identifiers: {},
                    languages: []
                };

                const contentDiv = entry.content?.div;
                let contentStr = '';
                if (contentDiv) {
                    if (typeof contentDiv === 'string') {
                        contentStr = contentDiv;
                    } else if (contentDiv._) {
                        contentStr = contentDiv._;
                    }
                }

                if (contentStr) {
                    const terminato = parseTerminato(contentStr);
                    if (terminato) {
                        book.read_at = terminato;
                    }

                    const description = parseDescription(contentStr);
                    if (description) {
                        book.description = description;
                    }

                    const tagMatch = contentStr.match(/TAG: ([^\n]+)/);
                    if (tagMatch) {
                        book.tags = tagMatch[1].split(', ').map(tag => tag.trim());
                    }

                    const publisherMatch = contentStr.match(/Editore: ([^\n]+)/);
                    if (publisherMatch) {
                        book.publisher = publisherMatch[1].trim();
                    }

                    const languageMatch = contentStr.match(/Lingua: ([^\n]+)/);
                    if (languageMatch) {
                        book.languages = [languageMatch[1].trim()];
                    }

                    const ratingMatch = contentStr.match(/Valutazione: (\d+)/);
                    if (ratingMatch) {
                        book.user_metadata['#rating'] = { value: parseInt(ratingMatch[1]) };
                    }
                }

                if (contentDiv && contentDiv.p) {
                    const descriptionFromTag = typeof contentDiv.p === 'string' ? contentDiv.p : contentDiv.p._ || null;
                    if (descriptionFromTag) {
                        book.description = descriptionFromTag.trim();
                    }
                }

                const links = Array.isArray(entry.link) ? entry.link : [entry.link];
                for (const link of links) {
                    if (link && link.$ && link.$.rel === 'http://opds-spec.org/cover') {
                        book.cover_url = `${CALIBRE_URL}${link.$.href}`;
                        break;
                    }
                }

                books.push(book);
            } catch (error) {
                console.warn(`⚠️  Errore parsing libro:`, error.message);
            }
        }


        return books;
    } catch (error) {
        console.error('❌ Errore fetch libri Calibre:', error.message);
        throw error;
    }
}

/**
 * Upsert libro singolo nel database
 */
async function upsertBookDirect(book) {
    try {
        const query = `
            INSERT INTO read_books (id, title, authors, tags, publisher, published_date, isbn, language, last_modified, read_at, description, cover_url, rating, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
            ON CONFLICT (id)
            DO UPDATE SET
                title = EXCLUDED.title,
                authors = EXCLUDED.authors,
                tags = EXCLUDED.tags,
                publisher = EXCLUDED.publisher,
                published_date = EXCLUDED.published_date,
                isbn = EXCLUDED.isbn,
                language = EXCLUDED.language,
                last_modified = EXCLUDED.last_modified,
                read_at = COALESCE(EXCLUDED.read_at, read_books.read_at),
                description = COALESCE(EXCLUDED.description, read_books.description),
                cover_url = COALESCE(EXCLUDED.cover_url, read_books.cover_url),
                rating = EXCLUDED.rating,
                updated_at = NOW()
        `;
        await pool.query(query, [
            book.id,
            book.title,
            JSON.stringify([book.authors]) || null,
            book.tags && book.tags.length > 0 ? JSON.stringify(book.tags) : null,
            book.publisher,
            book.published_date,
            book.identifiers?.isbn || null,
            book.language || null,
            book.last_modified,
            book.read_at,
            book.description || null,
            book.cover_url || null,
            book.rating
        ]);
    } catch (error) {
        console.error(`❌ Errore upsert libro ${book.title}:`, error.message);
        throw error;
    }
}

/**
 * PHASE 4: Fetch Books da Calibre
 */
async function fetchPhase() {
    console.log('\n📚 PHASE 4: Recupero libri da Calibre\n');
    try {
        const books = await fetchBooksFromCalibre();
        console.log(`✅ Recuperati ${books.length} libri da Calibre\n`);
        return books;
    } catch (error) {
        console.error('❌ Errore fetching libri:', error.message);
        process.exit(1);
    }
}

/**
 * PHASE 5: Bulk Insert
 */
async function insertPhase(books) {
    console.log('⚙️  PHASE 5: Inserimento massivo libri\n');

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < books.length; i++) {
        try {
            const book = books[i];
            book.id = book.uuid; // Usa uuid come id
            book.rating = book.user_metadata['#rating']?.value || null;
            book.language = book.languages?.[0] || null;
            book.tags = book.tags || [];

            await upsertBookDirect(book);
            successCount++;

            // Log progresso ogni 100 libri
            if ((i + 1) % 100 === 0) {
                console.log(`   Processati ${i + 1}/${books.length} libri...`);
            }
        } catch (error) {
            errorCount++;
            if (errorCount <= 5) {
                // Log solo primi 5 errori
                console.warn(`⚠️  Errore libro #${i + 1}: ${error.message}`);
            }
        }
    }

    console.log(`\n✅ Inseriti con successo: ${successCount} libri`);
    if (errorCount > 0) {
        console.warn(`⚠️  Errori durante insert: ${errorCount} libri`);
    }

    return { successCount, errorCount };
}

/**
 * PHASE 6: Verifica e Report
 */
async function verifyAndReport() {
    console.log('\n📊 PHASE 6: Verifica e Report Finale\n');

    try {
        const totalRes = await pool.query('SELECT COUNT(*) as count FROM read_books');
        const withRatingRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE rating IS NOT NULL');
        const withReadAtRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE read_at IS NOT NULL');
        const withDescriptionRes = await pool.query("SELECT COUNT(*) as count FROM read_books WHERE description IS NOT NULL AND description <> ''");
        const withTagsRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE tags IS NOT NULL');
        const withCoverRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE cover_url IS NOT NULL');

        const total = totalRes.rows[0].count;
        const withRating = withRatingRes.rows[0].count;
        const withReadAt = withReadAtRes.rows[0].count;
        const withDescription = withDescriptionRes.rows[0].count;
        const withTags = withTagsRes.rows[0].count;
        const withCover = withCoverRes.rows[0].count;

        console.log('════════════════════════════════════════');
        console.log('📈 STATISTICHE DATABASE');
        console.log('════════════════════════════════════════');
        console.log(`📚 Totale libri:               ${total}`);
        console.log(`📅 Con terminato/read_at:       ${withReadAt}`);
        console.log(`📝 Con descrizione:            ${withDescription}`);
        console.log(`⭐ Con rating:                 ${withRating}`);
        console.log(`🏷️  Con tags:                  ${withTags}`);
        console.log(`🖼️  Con copertina:             ${withCover}`);
        console.log('════════════════════════════════════════\n');

        // Mostra campione di libri
        console.log('📝 Campione primi 5 libri:');
        const sampleRes = await pool.query('SELECT id, title, rating FROM read_books ORDER BY id LIMIT 5');
        sampleRes.rows.forEach((book, i) => {
            const rating = book.rating ? `⭐ ${book.rating}` : 'senza rating';
            console.log(`   ${i + 1}. [${book.id}] ${book.title} ${rating}`);
        });
        console.log();

        return { total, withRating, withTags, withCover };
    } catch (error) {
        console.error('❌ Errore verifica:', error.message);
        throw error;
    }
}

/**
 * PHASE 7: Cleanup e Finale
 */
async function cleanup() {
    console.log('\n🧹 PHASE 7: Cleanup\n');

    try {
        await cleanupOldBackups();
        console.log('✅ Backup vecchi puliti');
    } catch (error) {
        console.warn('⚠️  Errore cleanup backup:', error.message);
    }

    // Chiudi pool
    await pool.end();
    console.log('✅ Connessione database chiusa');
}

/**
 * Main orchestrator
 */
async function fullRefresh() {
    const startTime = Date.now();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  🚀 FULL DATABASE REFRESH              ║');
    console.log('║     Truncate → Fetch → Insert          ║');
    console.log('╚════════════════════════════════════════╝\n');

    try {
        // Phase 1
        await validateConnections();

        // Phase 2
        await createBackup();

        // Phase 3
        await truncateTable();

        // Phase 4
        const books = await fetchPhase();

        // Phase 5
        const { successCount, errorCount } = await insertPhase(books);

        // Phase 6
        const stats = await verifyAndReport();

        // Phase 7
        await cleanup();

        // Summary
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║  ✅ FULL REFRESH COMPLETATO            ║');
        console.log('╚════════════════════════════════════════╝\n');
        console.log(`⏱️  Tempo totale: ${elapsedTime}s`);
        console.log(`📊 Risultato: ${stats.total} libri nel database\n`);

        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERRORE CRITICO:', error.message);
        console.error('   Operazione abortita. Backup disponibile per rollback.\n');

        // Chiudi pool anche in caso di errore
        try {
            await pool.end();
        } catch (e) {
            // ignore
        }

        process.exit(1);
    }
}

// Gestisci errori non catturati
process.on('unhandledRejection', (error) => {
    console.error('❌ Errore non gestito:', error);
    process.exit(1);
});

// Avvia
fullRefresh();
