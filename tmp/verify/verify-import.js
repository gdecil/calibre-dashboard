const { pool } = require('./database');

async function test() {
  try {
    console.log('🔍 Test connessione al database...');
    const res = await pool.query('SELECT 1');
    console.log('✅ Connessione OK');
    
    console.log('\n📊 Verifica dati nel database:');
    const countRes = await pool.query('SELECT COUNT(*) as count FROM read_books');
    console.log(`  Totale libri: ${countRes.rows[0].count}`);
    
    const dateRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE read_at IS NOT NULL');
    console.log(`  Con data lettura: ${dateRes.rows[0].count}`);
    
    const coverRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE cover_url IS NOT NULL');
    console.log(`  Con copertina: ${coverRes.rows[0].count}`);
    
    const descRes = await pool.query('SELECT COUNT(*) as count FROM read_books WHERE description IS NOT NULL');
    console.log(`  Con descrizione: ${descRes.rows[0].count}`);
    
    console.log('\n📚 Ultimi 5 libri importati:');
    const last = await pool.query('SELECT id, title, read_at FROM read_books ORDER BY updated_at DESC LIMIT 5');
    last.rows.forEach((libro, i) => {
      const data = libro.read_at ? new Date(libro.read_at).toLocaleDateString('it-IT') : 'senza data';
      console.log(`  ${i+1}. [${libro.id}] ${libro.title} - ${data}`);
    });
    
    console.log('\n✅ Verifica completata con successo!');
    
  } catch (error) {
    console.error('❌ Errore:', error.message);
    process.exit(1);
  }
  await pool.end();
}

test();
