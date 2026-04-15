const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { CronJob } = require('node-cron');
const { initializeDatabase, getReadBooks, getStats, searchBooks } = require('./database');
const { startSyncWorker } = require('./sync-worker');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Inizializza database e worker di sincronizzazione
initializeDatabase().then(() => {
    console.log('✅ Database inizializzato');
    startSyncWorker();
}).catch(error => {
    console.error('❌ Errore inizializzazione:', error.message);
    process.exit(1);
});

app.get('/api/books', async (req, res) => {
  try {
    const books = await getReadBooks();
    res.json(books);
  } catch (error) {
    console.error('Errore API /api/books:', error.message);
    res.status(500).json({ 
      error: 'Errore nel recupero libri dal database', 
      details: error.message
    });
  }
});

app.get('/api/books/read', async (req, res) => {
  try {
    const books = await getReadBooks();
    res.json(books);
  } catch (error) {
    console.error('Server Calibre non raggiungibile:', error.message);
    // Modalità Demo: restituisci dati di esempio quando server non disponibile
    res.json([
      { id: 1, title: "1984", authors: ["George Orwell"], user_metadata: { '#rating': { value: 5 }, '#read': { value: true } } },
      { id: 2, title: "Il Nome della Rosa", authors: ["Umberto Eco"], user_metadata: { '#rating': { value: 5 }, '#read': { value: true } } },
      { id: 3, title: "Fondazione", authors: ["Isaac Asimov"], user_metadata: { '#rating': { value: 4 }, '#read': { value: true } } },
      { id: 4, title: "Dune", authors: ["Frank Herbert"], user_metadata: { '#rating': { value: 5 }, '#read': { value: true } } },
      { id: 5, title: "Neuromante", authors: ["William Gibson"], user_metadata: { '#rating': { value: 4 }, '#read': { value: true } } },
      { id: 6, title: "Il Signore degli Anelli", authors: ["J.R.R. Tolkien"], user_metadata: { '#rating': { value: 5 }, '#read': { value: true } } }
    ]);
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    console.error('Server Calibre non raggiungibile:', error.message);
    // Modalità Demo: statistiche di esempio
    res.json({
      total_books: 1247,
      read_books: 312,
      percentage_read: 25,
      top_authors: [
        ["Isaac Asimov", 23], ["Arthur C. Clarke", 18], ["Philip K. Dick", 15],
        ["Umberto Eco", 12], ["George Orwell", 9], ["Frank Herbert", 8],
        ["William Gibson", 7], ["J.R.R. Tolkien", 6], ["Neil Gaiman", 5], ["Dan Simmons", 4]
      ],
      top_genres: [
        ["Fantascienza", 112], ["Fantasy", 78], ["Thriller", 45], 
        ["Storia", 32], ["Filosofia", 25], ["Biografia", 20]
      ],
      rating_distribution: { 1: 3, 2: 12, 3: 45, 4: 138, 5: 114 }
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint per trigger manuale sync
app.post('/api/sync', async (req, res) => {
  try {
    const { fetchBooksFromCalibre, updateReadBooks } = require('./sync-worker');
    const books = await fetchBooksFromCalibre();
    const readBooks = books.filter(book => 
        book.user_metadata && 
        book.user_metadata['#read'] && 
        book.user_metadata['#read'].value === true
    );
    await updateReadBooks(readBooks);
    res.json({ success: true, updated_books: readBooks.length });
  } catch (error) {
    console.error('❌ Errore sync manuale:', error.message);
    res.status(500).json({ 
      error: 'Errore durante sincronizzazione manuale', 
      details: error.message 
    });
  }
});

// Endpoint ricerca libri
app.get('/api/books/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.json([]);
    }
    const results = await searchBooks(query);
    res.json(results);
  } catch (error) {
    console.error('❌ Errore ricerca libri:', error.message);
    res.status(500).json({ 
      error: 'Errore durante ricerca libri', 
      details: error.message 
    });
  }
});

function startServer() {
  app.listen(PORT, () => {
    console.log('');
    console.log(`✅ Server Calibre Dashboard avviato su http://localhost:${PORT}`);
    console.log(`🔗 Connesso a server Calibre: ${process.env.CALIBRE_URL || 'http://localhost:8090'}`);
    console.log('');
  });
}

if (!process.env.CALIBRE_URL) {
  console.log('📚 Calibre Dashboard');
  console.log('====================');
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Inserisci l\'indirizzo del tuo server Calibre (es. http://localhost:8090): ', (answer) => {
    process.env.CALIBRE_URL = answer.trim();
    rl.close();
    startServer();
  });
} else {
  startServer();
}