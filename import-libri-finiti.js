const fs = require('fs');
const xml2js = require('xml2js');
const { pool, initializeDatabase } = require('./database');

// Mappa mesi italiani
const MESI_ITALIANI = {
    'gen': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'mag': 4, 'giu': 5,
    'lug': 6, 'ago': 7, 'set': 8, 'ott': 9, 'nov': 10, 'dic': 11
};

/**
 * Parsa data formato "terminato: 19 giu 2023"
 */
function parseDataTerminato(testo) {
    const match = testo.match(/terminato:\s*(\d{1,2})\s+([a-z]{3})\s+(\d{4})/i);
    if (!match) return null;

    const giorno = parseInt(match[1], 10);
    const mese = MESI_ITALIANI[match[2].toLowerCase()];
    const anno = parseInt(match[3], 10);

    if (mese === undefined) return null;

    return new Date(anno, mese, giorno, 12, 0, 0);
}

/**
 * Estrai ID libro da url cover
 */
function estraiIdLibro(urlCover) {
    const match = urlCover.match(/\/get\/cover\/(\d+)\//);
    return match ? match[1] : null;
}

/**
 * Upsert libro con i nuovi campi
 */
async function upsertLibroCompleto(libro) {
    const query = `
        INSERT INTO read_books (
            id, title, authors, description, cover_url, read_at,
            last_modified, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (id)
        DO UPDATE SET
            title = EXCLUDED.title,
            authors = EXCLUDED.authors,
            description = COALESCE(EXCLUDED.description, read_books.description),
            cover_url = COALESCE(EXCLUDED.cover_url, read_books.cover_url),
            read_at = COALESCE(EXCLUDED.read_at, read_books.read_at),
            last_modified = EXCLUDED.last_modified,
            updated_at = NOW()
    `;

    await pool.query(query, [
        libro.id,
        libro.title,
        JSON.stringify(libro.authors),
        libro.description || null,
        libro.cover_url || null,
        libro.read_at || null,
        libro.last_modified
    ]);
}

async function importaLibriFiniti() {
    console.log('🚀 Inizio importazione libri finiti da OPDS XML\n');

    // Connetti al database
    const dbOk = await initializeDatabase();
    if (!dbOk) {
        console.error('❌ Impossibile connettersi al database');
        process.exit(1);
    }

    // Leggi file XML
    console.log('📄 Lettura file libri_finiti.xml...');
    // File è in formato UTF-16 Little Endian con BOM
    let xmlContent = fs.readFileSync('./libri_finiti.xml', 'utf16le');
    
    // Rimuovi BOM (Byte Order Mark) se presente all'inizio del file
    xmlContent = xmlContent.replace(/^\uFEFF/, '');

    // Parsa XML
    console.log('🔍 Parsing XML...');
    const parser = new xml2js.Parser({
        explicitArray: false,
        trim: true
    });

    const result = await parser.parseStringPromise(xmlContent);
    const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];

    console.log(`✅ Trovati ${entries.length} libri nel feed\n`);

    let importati = 0;
    let conData = 0;
    let conDescrizione = 0;
    let conCopertina = 0;

    // Processa ogni libro
    for (const [index, entry] of entries.entries()) {
        try {
            const titolo = entry.title;
            const autori = Array.isArray(entry.author)
                ? entry.author.map(a => a.name)
                : [entry.author.name];

            const ultimoAggiornamento = entry.updated ? new Date(entry.updated) : new Date();

            // Estrai contenuto XHTML
            const contenutoHtml = entry.content.div._ || entry.content.div;

            // Estrai data terminato
            const dataTerminato = parseDataTerminato(contenutoHtml);

            // Estrai descrizione
            let descrizione = null;
            if (contenutoHtml.p && contenutoHtml.p.$ && contenutoHtml.p.$.class === 'description') {
                descrizione = contenutoHtml.p._ || contenutoHtml.p;
            }

            // Estrai URL copertina
            let urlCopertina = null;
            let idLibro = null;

            const links = Array.isArray(entry.link) ? entry.link : [entry.link];
            for (const link of links) {
                if (link.$.rel === 'http://opds-spec.org/cover') {
                    urlCopertina = `http://localhost:8090${link.$.href}`;
                    idLibro = estraiIdLibro(link.$.href);
                    break;
                }
            }

            if (!idLibro) {
                console.log(`⚠️  Libro senza ID valido: ${titolo} - saltato`);
                continue;
            }

            const libro = {
                id: idLibro,
                title: titolo,
                authors: autori,
                description: descrizione,
                cover_url: urlCopertina,
                read_at: dataTerminato,
                last_modified: ultimoAggiornamento
            };

            // Salva nel database
            await upsertLibroCompleto(libro);

            // Statistiche
            importati++;
            if (dataTerminato) conData++;
            if (descrizione) conDescrizione++;
            if (urlCopertina) conCopertina++;

            // Progresso ogni 50 libri
            if ((index + 1) % 50 === 0) {
                console.log(`   Processati ${index + 1}/${entries.length} libri...`);
            }

        } catch (error) {
            console.log(`❌ Errore processando libro ${index + 1}:`, error.message);
        }
    }

    // Report finale
    console.log('\n✅ Importazione completata!');
    console.log('────────────────────────────────────');
    console.log(`📚 Totale libri processati: ${importati}`);
    console.log(`📅 Libri con data lettura:    ${conData}`);
    console.log(`📝 Libri con descrizione:     ${conDescrizione}`);
    console.log(`🖼️  Libri con copertina:      ${conCopertina}`);
    console.log('────────────────────────────────────');

    await pool.end();
    process.exit(0);
}

// Gestisci errori non catturati
process.on('unhandledRejection', (error) => {
    console.error('❌ Errore non gestito:', error);
    process.exit(1);
});

// Avvia importazione
importaLibriFiniti();