-- Aggiungi campi per il sistema di arricchimento ai libri esistenti
ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS subtitle VARCHAR(500);

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS page_count INTEGER;

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS cover_url VARCHAR(500);

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS ratings_count INTEGER;

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS last_enriched TIMESTAMP;

ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS enrichment_sources VARCHAR(100);

-- Crea indici per i nuovi campi
CREATE INDEX IF NOT EXISTS idx_read_books_last_enriched ON read_books(last_enriched);
CREATE INDEX IF NOT EXISTS idx_read_books_ratings_count ON read_books(ratings_count);