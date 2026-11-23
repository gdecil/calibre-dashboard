-- Aggiungi campo ordine di lettura (OrdLett) estratto dal database Calibre
ALTER TABLE read_books
ADD COLUMN IF NOT EXISTS reading_order INTEGER;

-- Crea indice per ordinare i libri per ordine di lettura
CREATE INDEX IF NOT EXISTS idx_read_books_reading_order ON read_books(reading_order);
