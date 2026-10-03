const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const SqliteDatabase = require('better-sqlite3');
const { CronJob } = require('node-cron');

// Forza ricaricamento del modulo database per evitare cache
delete require.cache[require.resolve('./database')];
const { initializeDatabase, getReadBooks, getStats, getAdvancedStats, searchBooks, getCoverPath } = require('./database');
const { startSyncWorker } = require('./sync-worker');
const { groupSearchResults, selectSearchCandidates } = require('./services/semantic-search');
const {
  buildSummaryBatchMessages,
  buildSummaryBatchRepairMessages,
  combineSummaryNotes,
  getUncitedSummarySources,
  getBookSummaryChunks,
  getBookSummaryChunksByCalibreId,
  isBookSummaryRequest,
  normalizeSummaryNoteCitations,
  restoreSummaryCitations,
  splitSummarySources
} = require('./services/book-summary');
const {
  FullTextIndexUnavailableError,
  searchExactOccurrences
} = require('./services/lexical-search');
const {
  INSUFFICIENT_EVIDENCE,
  buildCitationRepairMessages,
  buildGroundedContext,
  buildRetrievalQuery,
  isDeepeningRequest,
  validateCitations
} = require('./services/ai-rag');
const aiChatStore = require('./services/ai-chat-store')();

const app = express();
const PORT = process.env.PORT || 3000;
const AI_DB_PATH = process.env.CALIBRE_AI_DB_PATH || path.resolve(__dirname, '..', 'calibre-ai', 'data', 'calibre.db');
const AI_QDRANT_URL = (process.env.AI_QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
const AI_QDRANT_COLLECTION = process.env.AI_QDRANT_COLLECTION || 'calibre_chunks_disk';
const AI_QDRANT_SEARCH_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.AI_QDRANT_SEARCH_TIMEOUT_MS, 10) || 180000,
  10000
);
const AI_OLLAMA_URL = process.env.AI_OLLAMA_URL || 'http://localhost:11434/api/embed';
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'qwen3-embedding';
const AI_OLLAMA_CHAT_URL = process.env.AI_OLLAMA_CHAT_URL || 'http://localhost:11434/api/chat';
const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'mistral-nemo';
const AI_BOOK_SUMMARY_MODEL = process.env.AI_BOOK_SUMMARY_MODEL || 'qwen3:14b';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

function wrapAiDependencyError(stage, error) {
  const responseError = error.response?.data?.error || error.response?.data?.status?.error;
  const detail = typeof responseError === 'string' ? responseError : error.message;
  const wrapped = new Error(`${stage}: ${detail}`);
  wrapped.stage = stage;
  wrapped.upstreamStatus = error.response?.status;
  return wrapped;
}

async function generateAiText(messages, stage, model = AI_CHAT_MODEL, { bookSummary = false } = {}) {
  try {
    const response = await axios.post(
      AI_OLLAMA_CHAT_URL,
      {
        model,
        stream: false,
        think: bookSummary ? false : undefined,
        options: { temperature: 0, num_ctx: 16384, num_predict: bookSummary ? 1024 : 512 },
        messages
      },
      { timeout: 180000 }
    );
    return String(response.data.message?.content || '').trim();
  } catch (error) {
    throw wrapAiDependencyError(stage, error);
  }
}

async function generateCitedText(messages, sources, stage, model = AI_CHAT_MODEL, options = {}) {
  let answer = await generateAiText(messages, stage, model, options);
  let citationCheck = validateCitations(answer, sources);
  if (!citationCheck.valid) {
    answer = await generateAiText(
      buildCitationRepairMessages(messages, answer, sources),
      `${stage} citazioni`,
      model,
      options
    );
    citationCheck = validateCitations(answer, sources);
  }
  return { answer, citationCheck };
}

async function generateBookSummary(bookTitle, sources) {
  const batches = splitSummarySources(sources);
  const notes = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const localBatch = batch.map((source, sourceIndex) => ({
      ...source,
      citation: `C${sourceIndex + 1}`
    }));
    const messages = buildSummaryBatchMessages(bookTitle, localBatch, index + 1, batches.length, sources.length);
    let note = normalizeSummaryNoteCitations(
      await generateAiText(messages, 'Sintesi dei capitoli Ollama', AI_BOOK_SUMMARY_MODEL, { bookSummary: true })
    );
    let citationCheck = validateCitations(note, localBatch);
    let uncitedSources = getUncitedSummarySources(note, localBatch);
    if (!citationCheck.valid || uncitedSources.length) {
      note = normalizeSummaryNoteCitations(await generateAiText(
        buildSummaryBatchRepairMessages(messages, note, localBatch),
        'Citazioni della sintesi Ollama',
        AI_BOOK_SUMMARY_MODEL,
        { bookSummary: true }
      ));
      citationCheck = validateCitations(note, localBatch);
      uncitedSources = getUncitedSummarySources(note, localBatch);
    }
    if (!citationCheck.valid || uncitedSources.length) {
      throw new Error(`Sintesi del gruppo ${index + 1} priva di citazioni valide per tutte le fonti`);
    }
    notes.push(restoreSummaryCitations(note, batch));
  }

  const answer = combineSummaryNotes(notes);
  return { answer, citationCheck: validateCitations(answer, sources) };
}

async function retrieveAiChunks(query, limit, { question = query, excludeChunkIds = [] } = {}) {
  let embeddingResponse;
  try {
    embeddingResponse = await axios.post(
      AI_OLLAMA_URL,
      { model: AI_EMBEDDING_MODEL, input: [query] },
      { timeout: 120000 }
    );
  } catch (error) {
    throw wrapAiDependencyError('Ollama embedding', error);
  }
  const vector = embeddingResponse.data.embeddings?.[0];
  if (!vector) throw new Error('Ollama non ha restituito un embedding');

  let searchResponse;
  try {
    const searchLimit = Math.min(limit + excludeChunkIds.length * 5, 200);
    searchResponse = await axios.post(
      `${AI_QDRANT_URL}/collections/${AI_QDRANT_COLLECTION}/points/query`,
      { query: vector, limit: searchLimit, with_payload: true, params: { indexed_only: true } },
      {
        timeout: AI_QDRANT_SEARCH_TIMEOUT_MS + 10000,
        params: { timeout: Math.ceil(AI_QDRANT_SEARCH_TIMEOUT_MS / 1000) }
      }
    );
  } catch (error) {
    throw wrapAiDependencyError('Ricerca Qdrant', error);
  }

  const points = selectSearchCandidates(searchResponse.data.result?.points || [], {
    query: question,
    limit,
    excludeChunkIds
  });
  if (searchResponse.data.time > 15) {
    console.warn(`Ricerca Qdrant lenta: ${searchResponse.data.time}s (${points.length} risultati)`);
  }
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
    res.status(503).json({
      error: 'Ricerca semantica non disponibile',
      details: error.message,
      stage: error.stage || 'lettura dei passaggi',
      upstream_status: error.upstreamStatus || null
    });
  }
});

app.get('/api/ai/occurrences', (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 250);
  const excerptsPerBook = Math.min(Math.max(Number.parseInt(req.query.per_book, 10) || 3, 1), 10);
  if (!query) return res.json({ query, results: [], matched_chunks: 0, has_more: false });
  if (query.length > 200) {
    return res.status(400).json({ error: 'La ricerca non può superare 200 caratteri' });
  }

  let database;
  try {
    database = new SqliteDatabase(AI_DB_PATH, { readonly: true, fileMustExist: true });
    const result = searchExactOccurrences(database, query, {
      limit,
      excerptsPerBook,
      chunkBudget: 5000
    });
    res.json(result);
  } catch (error) {
    if (error instanceof FullTextIndexUnavailableError) {
      return res.status(503).json({
        error: error.message,
        code: error.code,
        index_state: error.state
      });
    }
    console.error('Errore ricerca per occorrenze:', error.message);
    res.status(503).json({ error: 'Ricerca testuale non disponibile', details: error.message });
  } finally {
    if (database) database.close();
  }
});

app.get('/api/ai/conversations', (req, res) => {
  try {
    res.json({ conversations: aiChatStore.listConversations() });
  } catch (error) {
    res.status(500).json({ error: 'Cronologia conversazioni non disponibile', details: error.message });
  }
});

app.get('/api/ai/conversations/:id', (req, res) => {
  try {
    const conversation = aiChatStore.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversazione non trovata' });
    res.json({ conversation });
  } catch (error) {
    res.status(500).json({ error: 'Conversazione non disponibile', details: error.message });
  }
});

app.delete('/api/ai/conversations/:id', (req, res) => {
  try {
    if (!aiChatStore.deleteConversation(req.params.id)) {
      return res.status(404).json({ error: 'Conversazione non trovata' });
    }
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Conversazione non eliminata', details: error.message });
  }
});

app.get('/api/books/:id/summary', (req, res) => {
  const calibreBookId = String(req.params.id || '');
  if (!/^\d+$/.test(calibreBookId)) {
    return res.status(400).json({ error: 'ID libro non valido' });
  }

  try {
    res.json({ summary: aiChatStore.getBookSummary(calibreBookId) });
  } catch (error) {
    res.status(500).json({ error: 'Riassunto libro non disponibile', details: error.message });
  }
});

app.post('/api/books/:id/summary', async (req, res) => {
  const calibreBookId = String(req.params.id || '');
  if (!/^\d+$/.test(calibreBookId)) {
    return res.status(400).json({ error: 'ID libro non valido' });
  }

  let database;
  try {
    database = new SqliteDatabase(AI_DB_PATH, { readonly: true, fileMustExist: true });
    const bookSummary = getBookSummaryChunksByCalibreId(database, calibreBookId);
    database.close();
    database = null;

    if (!bookSummary) {
      return res.status(404).json({ error: 'Testo estratto del libro non disponibile per generare il riassunto.' });
    }

    const question = `Riassumi il libro ${bookSummary.book.title}`;
    const context = buildGroundedContext(question, bookSummary.chunks, [], { summaryMode: true });
    if (!context.sources.length) {
      return res.status(404).json({ error: 'Il libro non contiene capitoli narrativi riassumibili.' });
    }

    const result = await generateBookSummary(bookSummary.book.title, context.sources);
    if (!result.citationCheck.valid) {
      return res.status(502).json({ error: 'Riassunto rifiutato perché le citazioni non sono valide.' });
    }

    const sources = context.sources
      .filter((source) => result.citationCheck.citations.includes(source.citation))
      .map(({ text, prompt_excerpt, ...source }) => ({
        ...source,
        excerpt: prompt_excerpt.slice(0, 700)
      }));
    const summary = aiChatStore.saveBookSummary(
      calibreBookId,
      bookSummary.book.title,
      result.answer,
      sources,
      AI_BOOK_SUMMARY_MODEL
    );
    res.json({ summary });
  } catch (error) {
    if (database && database.open) database.close();
    console.error('Errore generazione riassunto libro:', error.message);
    res.status(503).json({
      error: 'Generazione riassunto non disponibile',
      details: error.message,
      stage: error.stage || 'recupero testo libro',
      upstream_status: error.upstreamStatus || null
    });
  }
});

app.post('/api/ai/ask', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  const requestedConversationId = String(req.body?.conversation_id || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.body?.limit, 10) || 4, 1), 6);
  if (!question) return res.status(400).json({ error: 'La domanda è obbligatoria' });
  if (question.length > 1000) {
    return res.status(400).json({ error: 'La domanda non può superare 1000 caratteri' });
  }

  try {
    const conversation = requestedConversationId
      ? aiChatStore.getConversation(requestedConversationId)
      : null;
    if (requestedConversationId && !conversation) {
      return res.status(404).json({ error: 'Conversazione non trovata' });
    }
    const history = (conversation?.messages || []).map(({ role, content, sources }) => ({ role, content, sources }));
    const summaryRequest = isBookSummaryRequest(question);
    let bookSummary = null;
    if (summaryRequest) {
      const summaryQuery = [
        ...history.filter((message) => message.role === 'user').slice(-2).map((message) => message.content),
        question
      ].join('\n');
      const database = new SqliteDatabase(AI_DB_PATH, { readonly: true, fileMustExist: true });
      try {
        bookSummary = getBookSummaryChunks(database, summaryQuery);
      } finally {
        database.close();
      }
    }
    const previousChunkIds = isDeepeningRequest(question)
      ? history
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.sources || [])
        .map((source) => source.chunk_id)
        .filter((chunkId) => chunkId !== undefined && chunkId !== null)
      : [];
    const chunks = bookSummary?.chunks || await retrieveAiChunks(buildRetrievalQuery(question, history), limit, {
      question,
      excludeChunkIds: previousChunkIds
    });
    const context = buildGroundedContext(question, chunks, history, { summaryMode: Boolean(bookSummary) });
    if (!context.sources.length) {
      const conversationId = conversation?.id || aiChatStore.createConversation(question);
      aiChatStore.saveTurn(conversationId, question, INSUFFICIENT_EVIDENCE, []);
      return res.json({
        answer: INSUFFICIENT_EVIDENCE,
        status: 'insufficient_evidence',
        reason: 'no_retrieved_passages',
        sources: [],
        conversation_id: conversationId
      });
    }

    let answer;
    let citationCheck = null;
    if (bookSummary) {
      ({ answer, citationCheck } = await generateBookSummary(bookSummary.book.title, context.sources));
    } else {
      answer = await generateAiText(context.messages, 'Generazione Ollama');
    }
    if (!bookSummary && answer !== INSUFFICIENT_EVIDENCE) {
      citationCheck = validateCitations(answer, context.sources);
      if (!citationCheck.valid) {
        console.warn(`Risposta RAG da correggere: citazioni non valide (${citationCheck.reason})`);
        answer = await generateAiText(
          buildCitationRepairMessages(context.messages, answer, context.sources),
          'Revisione citazioni Ollama'
        );
        if (answer !== INSUFFICIENT_EVIDENCE) {
          citationCheck = validateCitations(answer, context.sources);
        }
      }
    }

    if (answer === INSUFFICIENT_EVIDENCE) {
      const sources = context.sources.map(({ text, prompt_excerpt, ...source }) => ({
        ...source,
        excerpt: prompt_excerpt.slice(0, 700)
      }));
      const conversationId = conversation?.id || aiChatStore.createConversation(question);
      aiChatStore.saveTurn(conversationId, question, answer, sources);
      return res.json({
        answer: INSUFFICIENT_EVIDENCE,
        status: 'insufficient_evidence',
        reason: 'model_abstained',
        sources,
        conversation_id: conversationId
      });
    }

    if (!citationCheck.valid) {
      console.warn(`Risposta RAG scartata: citazioni non valide (${citationCheck.reason})`);
      return res.status(502).json({
        error: 'Il modello ha risposto senza citazioni valide per i passaggi recuperati.',
        code: 'invalid_citations',
        reason: citationCheck.reason
      });
    }

    const sources = context.sources
      .filter((source) => citationCheck.citations.includes(source.citation))
      .map(({ text, prompt_excerpt, ...source }) => ({
        ...source,
        excerpt: prompt_excerpt.slice(0, 700)
      }));
    const conversationId = conversation?.id || aiChatStore.createConversation(question);
    aiChatStore.saveTurn(conversationId, question, answer, sources);

    res.json({
      answer,
      status: 'answered',
      sources,
      conversation_id: conversationId
    });
  } catch (error) {
    console.error('Errore domanda AI:', error.message);
    res.status(503).json({
      error: 'Risposta AI non disponibile',
      details: error.message,
      stage: error.stage || 'preparazione risposta',
      upstream_status: error.upstreamStatus || null
    });
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