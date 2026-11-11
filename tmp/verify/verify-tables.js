const { pool } = require('./database');

async function verifyTables() {
    try {
        console.log('🔌 Connecting to database...');
        await pool.query('SELECT 1');
        console.log('✅ Database connection successful');

        console.log('📋 Checking current database and schema...');

        // Get current database
        const dbResult = await pool.query('SELECT current_database() as database');
        console.log(`📊 Current database: ${dbResult.rows[0].database}`);

        // Check all tables in public schema
        const tablesResult = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log('📊 Tables in public schema:');
        if (tablesResult.rows.length > 0) {
            tablesResult.rows.forEach(row => {
                console.log(`  - ${row.table_name}`);
            });
        } else {
            console.log('  No tables found in public schema');
        }

        // Check specifically for our tables
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

        console.log('🔍 Specific table checks:');
        console.log(`  read_books table exists: ${readBooksResult.rows[0].exists}`);
        console.log(`  backups table exists: ${backupsResult.rows[0].exists}`);

        // If tables exist, show their structure
        if (readBooksResult.rows[0].exists) {
            console.log('📋 read_books table structure:');
            const structureResult = await pool.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                AND table_name = 'read_books'
                ORDER BY ordinal_position
            `);
            structureResult.rows.forEach(row => {
                console.log(`  - ${row.column_name}: ${row.data_type}`);
            });
        }

    } catch (error) {
        console.error('❌ Error verifying tables:', error.message);
    } finally {
        await pool.end();
    }
}

verifyTables();