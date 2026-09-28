# calibre-dashboard

A web dashboard for managing and visualizing your Calibre ebook library.

## Features

- View and search your Calibre library
- Track reading progress
- Manage book metadata
- Export reading statistics
- OPDS feed support
- Google Books and Open Library enrichment

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/gdecil/calibre-dashboard.git
   cd calibre-dashboard
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure the direct Calibre SQLite database in `.env`:
   ```
   CALIBRE_DB_PATH=H:\\biblioteca\\metadata.db
   ```

   The dashboard reads books with status `Finito` directly from Calibre's
   `metadata.db`. PostgreSQL remains available for optional enrichment data.

4. Start the server:
   ```bash
   npm start
   ```

## Usage

Access the dashboard at `http://localhost:3000` in your web browser.

## API Endpoints

- `GET /api/books` - Retrieve all books
- `GET /api/books/search?q=term` - Search books
- `GET /api/stats` - Get reading statistics
- `GET /opds` - OPDS feed
- `GET /api/ai/search?q=...` - Semantic search grouped by book
- `POST /api/ai/ask` - Ask a question using retrieved passages and citations

The semantic analysis page is available at `/analysis.html`. AI endpoints require
the local Ollama and Qdrant services. Question answering uses `mistral-nemo` by
default; configure `AI_CHAT_MODEL` and `AI_OLLAMA_CHAT_URL` to use another Ollama
chat model or endpoint. Answers are restricted to retrieved passages and are
rejected when they do not cite a retrieved source.

## Development

Run tests:
```bash
npm test
```

Run in development mode:
```bash
npm run dev
```

## Database Schema

See `migrations/` for the SQL schema files.

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

GitHub: @gdecil