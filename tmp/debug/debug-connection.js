require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 Debugging database connection...');
console.log(`DATABASE_URL from .env: ${process.env.DATABASE_URL}`);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function debugConnection() {
    try {
        console.log('🔌 Testing connection...');
        const client = await pool.connect();
        console.log('✅ Connection established');

        const dbResult = await client.query('SELECT current_database() as database');
        console.log(`📊 Connected to database: ${dbResult.rows[0].database}`);

        const userResult = await client.query('SELECT current_user as user');
        console.log(`📊 Connected as user: ${userResult.rows[0].user}`);

        client.release();
    } catch (error) {
        console.error('❌ Connection error:', error.message);
        console.error('Full error:', error);
    } finally {
        await pool.end();
    }
}

debugConnection();