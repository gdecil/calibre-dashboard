const { pool } = require('./database');

async function checkTables() {
    try {
        console.log('🔌 Connecting to database...');
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful');

        console.log('📋 Checking for tables...');

        // Check all tables
        const tablesResult = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log('📊 Tables found:');
        if (tablesResult.rows.length > 0) {
            tablesResult.rows.forEach(row => {
                console.log(`- ${row.table_name}`);
            });
        } else {
            console.log('No tables found in public schema');
        }

        // Check specifically for our tables
        const readBooksResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'read_books'
            )
        `);

        const backupsResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'backups'
            )
        `);

        console.log('🔍 Specific table checks:');
        console.log(`read_books table exists: ${readBooksResult.rows[0].exists}`);
        console.log(`backups table exists: ${backupsResult.rows[0].exists}`);

    } catch (error) {
        console.error('❌ Error checking tables:', error.message);
    } finally {
        await pool.end();
    }
}

checkTables();