const { pool } = require('./database');

(async () => {
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS with_read_at,
        COUNT(*) FILTER (WHERE description IS NOT NULL AND description <> '') AS with_description,
        COUNT(*) FILTER (WHERE cover_url IS NOT NULL AND cover_url <> '') AS with_cover
      FROM read_books
    `);
    console.log(counts.rows[0]);

    const sample = await pool.query(
      `SELECT id, title, read_at, description, cover_url FROM read_books WHERE description IS NOT NULL LIMIT 2`
    );
    console.log(sample.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
