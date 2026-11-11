const { pool } = require('./database');

async function checkCalibreSchema() {
    try {
        console.log('🔌 Connecting to database...');
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful');

        console.log('📋 Checking for calibre schema and tables...');

        // Check if calibre schema exists
        const schemaResult = await pool.query(`
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = 'calibre'
        `);

        console.log(`📊 Calibre schema exists: ${schemaResult.rows.length > 0}`);

        // Check for tables in calibre schema
        const tablesResult = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'calibre'
            ORDER BY table_name
        `);

        console.log('📊 Tables in calibre schema:');
        if (tablesResult.rows.length > 0) {
            tablesResult.rows.forEach(row => {
                console.log(`- ${row.table_name}`);
            });
        } else {
            console.log('No tables found in calibre schema');
        }

        // Check specifically for our tables in calibre schema
        const readBooksResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'calibre'
                AND table_name = 'read_books'
            )
        `);

        const backupsResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'calibre'
                AND table_name = 'backups'
            )
        `);

        console.log('🔍 Specific table checks in calibre schema:');
        console.log(`calibre.read_books table exists: ${readBooksResult.rows[0].exists}`);
        console.log(`calibre.backups table exists: ${backupsResult.rows[0].exists}`);

        // Test a simple query on calibre.read_books
        try {
            const testQuery = await pool.query('SELECT COUNT(*) as count FROM calibre.read_books');
            console.log(`✅ Test query successful: ${testQuery.rows[0].count} books found`);
        } catch (error) {
            console.error('❌ Test query failed:', error.message);
        }

    } catch (error) {
        console.error('❌ Error checking calibre schema:', error.message);
    } finally {
        await pool.end();
    }
}

checkCalibreSchema();