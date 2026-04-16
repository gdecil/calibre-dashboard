const { pool } = require('./database');

async function finalVerification() {
    try {
        console.log('🔌 Connecting to database...');
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful');

        const dbResult = await pool.query('SELECT current_database() as database');
        console.log(`📊 Connected to database: ${dbResult.rows[0].database}`);

        // Check for our tables in public schema
        const readBooksResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'read_books'
            ) as exists
        `);

        const backupsResult = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'backups'
            ) as exists
        `);

        console.log('🔍 Table verification:');
        console.log(`  read_books table exists: ${readBooksResult.rows[0].exists}`);
        console.log(`  backups table exists: ${backupsResult.rows[0].exists}`);

        if (readBooksResult.rows[0].exists && backupsResult.rows[0].exists) {
            console.log('✅ SUCCESS: All required tables exist in the calibre database public schema!');
        } else {
            console.log('❌ ERROR: Some tables are missing');
        }

    } catch (error) {
        console.error('❌ Error during verification:', error.message);
    } finally {
        await pool.end();
    }
}

finalVerification();