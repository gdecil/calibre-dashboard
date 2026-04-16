-- Crea tabella libri letti
CREATE TABLE IF NOT EXISTS read_books (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    subtitle VARCHAR(500),
    authors JSONB,
    tags JSONB,
    publisher VARCHAR(200),
    published_date DATE,
    isbn VARCHAR(50),
    description TEXT,
    page_count INTEGER,
    language VARCHAR(50),
    cover_url VARCHAR(500),
    last_modified TIMESTAMP,
    read_at TIMESTAMP DEFAULT NOW(),
    rating INTEGER,
    ratings_count INTEGER,
    last_enriched TIMESTAMP,
    enrichment_sources VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Crea tabella backup
CREATE TABLE IF NOT EXISTS backups (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255),
    size INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_read_books_last_modified ON read_books(last_modified);
CREATE INDEX IF NOT EXISTS idx_read_books_read_at ON read_books(read_at);
CREATE INDEX IF NOT EXISTS idx_read_books_rating ON read_books(rating);
