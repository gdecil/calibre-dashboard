const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const SqliteDatabase = require('better-sqlite3');
const { CronJob } = require('node-cron');

// Forza ricaricamento del modulo database per evitare cache
delete require.cache[require.resolve('./database')];
const { initializeDatabase, getReadBooks, getStats, getAdvancedStats, searchBooks, getCoverPath } = require('./database');
const { startSyncWorker } = require('./sync-worker');
const { groupSearchResults } = require('./services/semantic-search');
const {
  INSUFFICIENT_EVIDENCE,
  buildGroundedContext,
  validateCitations
} = require('./services/ai-rag');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const AI_DB_PATH = process.env.CALIBRE_AI_DB_PATH || path.resolve(__dirname, '..', 'calibre-ai', 'data', 'calibre.db');
const AI_QDRANT_URL = (process.env.AI_QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
const AI_QDRANT_COLLECTION = process.env.AI_QDRANT_COLLECTION || 'calibre_chunks_disk';
const AI_OLLAMA_URL = process.env.AI_OLLAMA_URL || 'http://localhost:11434/api/embed';
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'qwen3-embedding';
const AI_OLLAMA_CHAT_URL = process.env.AI_OLLAMA_CHAT_URL || 'http://localhost:11434/api/chat';
const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'mistral-nemo';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function getAiSqliteStats() {
  const database = new SqliteDatabase(AI_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const count = (table) => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const indexed = database.prepare(`
      SELECT COUNT(DISTINCT chunk_id) AS count
      FROM embedding_index
      WHERE collection = ?
    `).get(AI_QDRANT_COLLECTION).count;
    const embeddingColumns = new Set(
      database.prepare('PRAGMA table_info(embedding_index)').all().map((column) => column.name)
    );
    const modelDigestColumn = embeddingColumns.has('model_digest') ? 'model_digest' : 'NULL';
    const indexerVersionColumn = embeddingColumns.has('indexer_version') ? 'indexer_version' : 'NULL';
    const embeddingIndexes = database.prepare(`
      SELECT
        model,
        dimensions,
        ${modelDigestColumn} AS model_digest,
        ${indexerVersionColumn} AS indexer_version,
        COUNT(DISTINCT chunk_id) AS indexed_chunks,
        MIN(indexed_at) AS first_indexed_at,
        MAX(indexed_at) AS last_indexed_at
      FROM embedding_index
      WHERE collection = ?
      GROUP BY model, dimensions, ${modelDigestColumn}, ${indexerVersionColumn}
      ORDER BY MAX(indexed_at) DESC
    `).all(AI_QDRANT_COLLECTION);

    return {
      books: count('books'),
      extracted_books: count('extracted_books'),
      chapters: count('extracted_chapters'),
      chunks: count('extracted_chunks'),
      indexed_chunks: indexed,
      embedding_indexes: embeddingIndexes
    };
  } finally {
    database.close();
  }
}

function getAiChunkTexts(chunkIds) {
  if (!chunkIds.length) return new Map();

  const database = new SqliteDatabase(AI_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const placeholders = chunkIds.map(() => '?').join(',');
    const rows = database.prepare(
      `SELECT id, text FROM extracted_chunks WHERE id IN (${placeholders})`
    ).all(...chunkIds);
    return new Map(rows.map((row) => [row.id, row.text]));
  } finally {
    database.close();
  }
}

async function retrieveAiChunks(query, limit) {
  const embeddingResponse = await axios.post(
    AI_OLLAMA_URL,
    { model: AI_EMBEDDING_MODEL, input: [query] },
    { timeout: 120000 }
  );
  const vector = embeddingResponse.data.embeddings?.[0];
  if (!vector) throw new Error('Ollama non ha restituito un embedding');

  const searchResponse = await axios.post(
    `${AI_QDRANT_URL}/collections/${AI_QDRANT_COLLECTION}/points/query`,
    { query: vector, limit, with_payload: true },
    { timeout: 30000 }
  );

  const points = searchResponse.data.result?.points || [];
  const chunkIds = points.map((point) => point.payload?.chunk_id ?? point.id);
  const chunkTexts = getAiChunkTexts(chunkIds);

  return points.map((point) => {
    const payload = point.payload || {};
    const chunkId = payload.chunk_id ?? point.id;
    return {
      id: point.id,
      score: point.score,
      ...payload,
      text: chunkTexts.get(chunkId) || payload.text || ''
    };
  });
}

async function getAiQdrantStats() {
  const response = await axios.get(
    `${AI_QDRANT_URL}/collections/${AI_QDRANT_COLLECTION}`,
    { timeout: 10000 }
  );
  const result = response.data.result;
  return {
    status: result.status,
    points: result.points_count,
    indexed_vectors: result.indexed_vectors_count,
    segments: result.segments_count
  };
}

app.get('/api/ai/index-status', async (req, res) => {
  try {
    const sqlite = getAiSqliteStats();
    let qdrant = null;
    let qdrantError = null;

    try {
      qdrant = await getAiQdrantStats();
    } catch (error) {
      qdrantError = error.message;
    }

    res.json({
      database: sqlite,
      qdrant,
      qdrant_error: qdrantError,
      coverage: sqlite.chunks ? Math.round((sqlite.indexed_chunks / sqlite.chunks) * 1000) / 10 : 0,
      collection: AI_QDRANT_COLLECTION,
      embedding_model: AI_EMBEDDING_MODEL,
      embedding_indexes: sqlite.embedding_indexes
    });
  } catch (error) {
    res.status(503).json({ error: 'Indice AI non disponibile', details: error.message });
  }
});

app.get('/api/ai/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);
  const excerptsPerBook = Math.min(Math.max(Number.parseInt(req.query.per_book, 10) || 2, 1), 5);
  if (!query) return res.json({ query, results: [] });

  try {
    const results = await retrieveAiChunks(query, Math.min(limit * 5, 200));

    res.json({
      query,
      results: groupSearchResults(results, { limit, excerptsPerBook })
    });
  } catch (error) {
    console.error('Errore ricerca AI:', error.message);
    res.status(503).json({ error: 'Ricerca semantica non disponibile', details: error.message });
  }
});

app.post('/api/ai/ask', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.body?.limit, 10) || 5, 1), 8);
  if (!question) return res.status(400).json({ error: 'La domanda è obbligatoria' });
  if (question.length > 1000) {
    return res.status(400).json({ error: 'La domanda non può superare 1000 caratteri' });
  }

  try {
    const chunks = await retrieveAiChunks(question, limit);
    const context = buildGroundedContext(question, chunks);
    if (!context.sources.length) {
      return res.json({ answer: INSUFFICIENT_EVIDENCE, sources: [] });
    }

    const response = await axios.post(
      AI_OLLAMA_CHAT_URL,
      {
        model: AI_CHAT_MODEL,
        stream: false,
        options: { temperature: 0 },
        messages: context.messages
      },
      { timeout: 180000 }
    );
    const answer = String(response.data.message?.content || '').trim();
    const citationCheck = validateCitations(answer, context.sources);
    if (!citationCheck.valid) {
      return res.json({ answer: INSUFFICIENT_EVIDENCE, sources: [] });
    }

    res.json({
      answer,
      sources: context.sources
        .filter((source) => citationCheck.citations.includes(source.citation))
        .map(({ text, ...source }) => ({ ...source, excerpt: text.slice(0, 700) }))
    });
  } catch (error) {
    console.error('Errore domanda AI:', error.message);
    res.status(503).json({ error: 'Risposta AI non disponibile', details: error.message });
  }
});

        // Inizializza database e worker di sincronizzazione
        // La connessione al server Calibre avviene solo durante gli aggiornamenti del database
        initializeDatabase().then(() => {
            console.log('✅ Database inizializzato');
          if (process.env.CALIBRE_DB_PATH) {
            console.log('📚 Lettura diretta dal database SQLite di Calibre attiva');
          } else {
            startSyncWorker();
          }
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
        ["William Gibson", 7], ["J.R.R. Tolkien", 6], ["Neil Gaiman", 5], ["Dan Simmons", 4],
        ["H.P. Lovecraft", 4], ["Ray Bradbury", 3], ["Stanisław Lem", 3], ["Italo Calvino", 3],
        ["Jules Verne", 2], ["H.G. Wells", 2], ["Aldous Huxley", 2], ["Ken Follett", 2],
        ["Stephen King", 2], ["Dan Brown", 1], ["Agatha Christie", 1], ["Primo Levi", 1],
        ["Ernest Hemingway", 1], ["Gabriel García Márquez", 1], ["Franz Kafka", 1]
      ],
      top_genres: [
        ["Fantascienza", 112], ["Fantasy", 78], ["Thriller", 45], 
        ["Storia", 32], ["Filosofia", 25], ["Biografia", 20]
      ],
      rating_distribution: { 1: 3, 2: 12, 3: 45, 4: 138, 5: 114 }
    });
  }
});

app.get('/api/advanced-stats', async (req, res) => {
  try {
    const stats = await getAdvancedStats();
    res.json(stats);
  } catch (error) {
    console.error('Errore statistiche avanzate:', error.message);
    res.status(500).json({ 
      error: 'Errore nel recupero statistiche avanzate', 
      details: error.message
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

// Proxy per le copertine Calibre
app.get(/^\/cover\/(.*)$/, async (req, res) => {
  const coverPath = req.params[0];

  if (process.env.CALIBRE_DB_PATH) {
    try {
      const filePath = getCoverPath(coverPath);
      if (!filePath) return res.status(404).send('Copertina non disponibile');

      return res.sendFile(filePath, {
        headers: {
          'Cache-Control': 'public, max-age=3600'
        }
      }, (error) => {
        if (error && !res.headersSent) res.status(error.statusCode || 500).send('Errore nel caricamento della copertina');
      });
    } catch (error) {
      console.error('❌ Errore lettura copertina Calibre:', error.message);
      return res.status(500).send('Errore nel caricamento della copertina');
    }
  }

  const CALIBRE_URL = process.env.CALIBRE_URL || 'http://192.168.1.5:8090';
  const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || '';
  const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || '';
  
  const url = `${CALIBRE_URL}/${coverPath}`;
  
  try {
    const response = await axios.get(url, {
      auth: {
        username: CALIBRE_USERNAME,
        password: CALIBRE_PASSWORD
      },
      responseType: 'stream',
      timeout: 10000
    });
    
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache per 1 ora
    response.data.pipe(res);
  } catch (error) {
    console.error('❌ Errore proxy copertina:', error.message);
    res.status(500).send('Errore nel caricamento della copertina');
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

if (!process.env.CALIBRE_URL && !process.env.CALIBRE_DB_PATH) {
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