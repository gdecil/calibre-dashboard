const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Inizializza il database
async function initializeDatabase() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Connessione al database stabilita');
        return true;
    } catch (error) {
        console.error('❌ Errore connessione database:', error.message);
        return false;
    }
}

// Test connessione database
function testDatabaseConnection() {
    return new Promise((resolve, reject) => {
        pool.query('SELECT 1', (error, result) => {
            if (error) {
                console.error('❌ Errore connessione database:', error.message);
                resolve(false);
            } else {
                console.log('✅ Database connesso con successo');
                resolve(true);
            }
        });
    });
}

// Backup database
function backupDatabase() {
    return new Promise((resolve, reject) => {
        try {
            const date = new Date();
            const filename = `backup_${date.toISOString().slice(0, 19).replace(/:/g, '-')}.sql`;
            const command = `"D:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe" -U postgres -d calibre -f backups/${filename}`;

            const { exec } = require('child_process');
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Errore backup:', error.message);
                    resolve(false);
                    return;
                }
                console.log(`✅ Backup creato: ${filename}`);

                // Registra backup nel database
                pool.query(
                    'INSERT INTO backups (filename, size) VALUES ($1, $2)',
                    [filename, stdout.length],
                    (err, result) => {
                        if (err) {
                            console.error('❌ Errore registrazione backup:', err.message);
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    }
                );
            });
        } catch (error) {
            console.error('❌ Errore backup database:', error.message);
            resolve(false);
        }
    });
}

// Pulisci backup vecchi
async function cleanupOldBackups() {
    try {
        const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 7;
        const query = `
            DELETE FROM backups 
            WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
        `;
        await pool.query(query);
        console.log(`✅ Backup vecchi eliminati (${retentionDays} giorni)`);
    } catch (error) {
        console.error('❌ Errore pulizia backup:', error.message);
    }
}

// Ottieni libri letti
async function getReadBooks() {
    try {
        const query = `
            SELECT * FROM read_books
            ORDER BY read_at DESC, title ASC
        `;
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('❌ Errore query libri letti:', error.message);
        throw error;
    }
}

// Ottieni statistiche
async function getStats() {
    try {
        const [totalQuery, readQuery, topAuthorsQuery, topGenresQuery, ratingsQuery, authorsCountQuery] = await Promise.all([
            pool.query('SELECT COUNT(*) as total FROM read_books'),
            pool.query('SELECT COUNT(*) as read FROM read_books'),
            pool.query(`
                SELECT authors, COUNT(*) as count, MAX(read_at) as last_read_date
                FROM read_books
                GROUP BY authors
                ORDER BY count DESC
            `),
            pool.query(`
                SELECT tags, COUNT(*) as count
                FROM read_books
                WHERE tags IS NOT NULL
                GROUP BY tags
                ORDER BY count DESC
            `),
            pool.query('SELECT rating, COUNT(*) as count FROM read_books GROUP BY rating'),
            pool.query(`
                SELECT COUNT(DISTINCT authors) as total_authors
                FROM read_books
                WHERE authors IS NOT NULL
            `)
        ]);

        const totalBooks = totalQuery.rows[0].total;
        const readBooks = readQuery.rows[0].read;
        const percentageRead = totalBooks > 0 ? Math.round((readBooks / totalBooks) * 100) : 0;
        const totalAuthors = authorsCountQuery.rows[0].total_authors || 0;

        // Converti gli autori in formato [nome, conteggio, last_read_date]
        const topAuthors = topAuthorsQuery.rows.map(row => [row.authors, row.count, row.last_read_date]);

        // Converti i generi in formato [nome, conteggio]
        const topGenres = topGenresQuery.rows.map(row => [row.tags, row.count]);

        const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingsQuery.rows.forEach(row => {
            if (row.rating >= 1 && row.rating <= 5) {
                ratingDistribution[row.rating] = row.count;
            }
        });

        return {
            total_books: totalBooks,
            read_books: readBooks,
            percentage_read: percentageRead,
            top_authors: topAuthors,
            top_genres: topGenres,
            rating_distribution: ratingDistribution,
            total_authors: totalAuthors
        };
    } catch (error) {
        console.error('❌ Errore query statistiche:', error.message);
        throw error;
    }
}

// Aggiungi/aggiorna libro
async function upsertBook(book) {
    try {
        const query = `
            INSERT INTO read_books (id, title, authors, tags, publisher, published_date, isbn, language, last_modified, rating)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
                rating = EXCLUDED.rating,
                updated_at = NOW()
            WHERE read_books.last_modified IS NULL
               OR read_books.last_modified < EXCLUDED.last_modified
        `;
        await pool.query(query, [
            book.id,
            book.title,
            book.authors,
            book.tags,
            book.publisher,
            book.published_date,
            book.isbn,
            book.language,
            book.last_modified,
            book.rating
        ]);
    } catch (error) {
        console.error('❌ Errore upsert libro:', error.message);
        throw error;
    }
}

// Ricerca libri
async function searchBooks(query) {
    try {
        const searchQuery = `
            SELECT * FROM read_books
            WHERE LOWER(title) LIKE LOWER($1)
               OR LOWER(authors::text) LIKE LOWER($1)
            ORDER BY read_at DESC, title ASC
            LIMIT 100
        `;
        const result = await pool.query(searchQuery, [`%${query}%`]);
        return result.rows;
    } catch (error) {
        console.error('❌ Errore ricerca libri:', error.message);
        throw error;
    }
}

// Ottieni statistiche avanzate
async function getAdvancedStats() {
    try {
        const [ratingDistQuery, yearDistQuery, languageDistQuery, genreDistQuery] = await Promise.all([
            pool.query(`
                SELECT rating, COUNT(*) as count 
                FROM read_books 
                WHERE rating IS NOT NULL 
                GROUP BY rating 
                ORDER BY rating DESC
            `),
            pool.query(`
                SELECT EXTRACT(YEAR FROM read_at)::integer as year, COUNT(*) as count
                FROM read_books
                WHERE read_at IS NOT NULL
                GROUP BY EXTRACT(YEAR FROM read_at)
                ORDER BY year DESC
            `),
            pool.query(`
                SELECT language, COUNT(*) as count
                FROM read_books
                WHERE language IS NOT NULL
                GROUP BY language
                ORDER BY count DESC
                LIMIT 10
            `),
            pool.query(`
                SELECT tags, COUNT(*) as count
                FROM read_books
                WHERE tags IS NOT NULL
                GROUP BY tags
                ORDER BY count DESC
                LIMIT 15
            `)
        ]);

        return {
            rating_distribution: ratingDistQuery.rows.map(row => [row.rating, row.count]),
            year_distribution: yearDistQuery.rows.map(row => [row.year, row.count]),
            language_distribution: languageDistQuery.rows.map(row => [row.language, row.count]),
            top_genres: genreDistQuery.rows.map(row => [row.tags, row.count])
        };
    } catch (error) {
        console.error('❌ Errore query statistiche avanzate:', error.message);
        throw error;
    }
}

module.exports = {
    initializeDatabase,
    backupDatabase,
    cleanupOldBackups,
    getReadBooks,
    getStats,
    getAdvancedStats,
    upsertBook,
    searchBooks,
    testDatabaseConnection,
    pool
};
