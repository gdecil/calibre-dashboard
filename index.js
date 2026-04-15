const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let CALIBRE_URL = process.env.CALIBRE_URL || process.argv[2];

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/books', async (req, res) => {
  try {
    const response = await axios.get(`${CALIBRE_URL}/interface-data/books-init`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Errore API /api/books:', error.message);
    res.status(500).json({ 
      error: 'Errore nel recupero libri da Calibre', 
      details: error.message,
      code: error.code
    });
  }
});

app.get('/api/books/read', async (req, res) => {
  try {
    const response = await axios.get(`${CALIBRE_URL}/interface-data/books-init`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.data || !response.data.books) {
      return res.json([]);
    }
    
    const books = Object.values(response.data.books);
    
    const readBooks = books.filter(book => {
      return book && 
             book.user_metadata && 
             book.user_metadata['#read'] && 
             book.user_metadata['#read'].value === true;
    });
    
    res.json(readBooks);
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
    const response = await axios.get(`${CALIBRE_URL}/interface-data/books-init`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.data || !response.data.books) {
      return res.json({
        total_books: 0,
        read_books: 0,
        percentage_read: 0,
        top_authors: [],
        top_genres: [],
        rating_distribution: { 1:0, 2:0, 3:0, 4:0, 5:0 }
      });
    }
    
    const books = Object.values(response.data.books);
    
    const readBooks = books.filter(book => {
      return book.user_metadata && 
             book.user_metadata['#read'] && 
             book.user_metadata['#read'].value === true;
    });
    
    const authorCounts = {};
    const genreCounts = {};
    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    readBooks.forEach(book => {
      if (book.authors) {
        book.authors.forEach(author => {
          authorCounts[author] = (authorCounts[author] || 0) + 1;
        });
      }
      
      if (book.tags) {
        book.tags.forEach(tag => {
          genreCounts[tag] = (genreCounts[tag] || 0) + 1;
        });
      }
      
      if (book.user_metadata && book.user_metadata['#rating']) {
        const rating = Math.round(book.user_metadata['#rating'].value);
        if (rating >= 1 && rating <=5) {
          ratingCounts[rating]++;
        }
      }
    });
    
    const topAuthors = Object.entries(authorCounts)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10);
      
    const topGenres = Object.entries(genreCounts)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10);
    
    res.json({
      total_books: books.length,
      read_books: readBooks.length,
      percentage_read: Math.round((readBooks.length / books.length) * 100),
      top_authors: topAuthors,
      top_genres: topGenres,
      rating_distribution: ratingCounts
    });
    
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

function startServer() {
  app.listen(PORT, () => {
    console.log('');
    console.log(`✅ Server Calibre Dashboard avviato su http://localhost:${PORT}`);
    console.log(`🔗 Connesso a server Calibre: ${CALIBRE_URL}`);
    console.log('');
  });
}

if (!CALIBRE_URL) {
  console.log('📚 Calibre Dashboard');
  console.log('====================');
  rl.question('Inserisci l\'indirizzo del tuo server Calibre (es. http://localhost:8090): ', (answer) => {
    CALIBRE_URL = answer.trim();
    rl.close();
    startServer();
  });
} else {
  startServer();
}
