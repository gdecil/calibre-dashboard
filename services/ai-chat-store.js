const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

function createAiChatStore(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.pragma('journal_mode = WAL');
    database.exec(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_conversation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            sources_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
            ON ai_conversation_messages(conversation_id, id);
        CREATE TABLE IF NOT EXISTS ai_book_summaries (
            calibre_book_id TEXT PRIMARY KEY,
            book_title TEXT NOT NULL,
            summary TEXT NOT NULL,
            sources_json TEXT NOT NULL DEFAULT '[]',
            model TEXT NOT NULL,
            generated_at TEXT NOT NULL
        );
    `);
    database.pragma('foreign_keys = ON');

    const insertTurn = database.transaction((conversationId, question, answer, sources) => {
        const now = new Date().toISOString();
        database.prepare(`
            INSERT INTO ai_conversation_messages
                (conversation_id, role, content, sources_json, created_at)
            VALUES (?, 'user', ?, '[]', ?)
        `).run(conversationId, question, now);
        database.prepare(`
            INSERT INTO ai_conversation_messages
                (conversation_id, role, content, sources_json, created_at)
            VALUES (?, 'assistant', ?, ?, ?)
        `).run(conversationId, answer, JSON.stringify(sources), now);
        database.prepare(`
            UPDATE ai_conversations
            SET updated_at = ?
            WHERE id = ?
        `).run(now, conversationId);
    });

    return {
        createConversation(title) {
            const id = randomUUID();
            const now = new Date().toISOString();
            database.prepare(`
                INSERT INTO ai_conversations (id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
            `).run(id, String(title || 'Nuova conversazione').trim().slice(0, 100), now, now);
            return id;
        },

        listConversations() {
            return database.prepare(`
                SELECT c.id, c.title, c.created_at, c.updated_at,
                    COUNT(m.id) AS message_count
                FROM ai_conversations c
                LEFT JOIN ai_conversation_messages m ON m.conversation_id = c.id
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT 100
            `).all();
        },

        getConversation(id) {
            const conversation = database.prepare(`
                SELECT id, title, created_at, updated_at
                FROM ai_conversations WHERE id = ?
            `).get(id);
            if (!conversation) return null;

            const messages = database.prepare(`
                SELECT id, role, content, sources_json, created_at
                FROM ai_conversation_messages
                WHERE conversation_id = ?
                ORDER BY id
            `).all(id).map(({ sources_json, ...message }) => ({
                ...message,
                sources: JSON.parse(sources_json)
            }));
            return { ...conversation, messages };
        },

        saveTurn(conversationId, question, answer, sources = []) {
            insertTurn(conversationId, question, answer, sources);
        },

        deleteConversation(id) {
            return database.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id).changes > 0;
        },

        getBookSummary(calibreBookId) {
            const summary = database.prepare(`
                SELECT calibre_book_id, book_title, summary, sources_json, model, generated_at
                FROM ai_book_summaries
                WHERE calibre_book_id = ?
            `).get(String(calibreBookId));
            if (!summary) return null;

            const { sources_json, ...result } = summary;
            return { ...result, sources: JSON.parse(sources_json) };
        },

        saveBookSummary(calibreBookId, bookTitle, summary, sources = [], model) {
            const generatedAt = new Date().toISOString();
            database.prepare(`
                INSERT INTO ai_book_summaries
                    (calibre_book_id, book_title, summary, sources_json, model, generated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(calibre_book_id) DO UPDATE SET
                    book_title = excluded.book_title,
                    summary = excluded.summary,
                    sources_json = excluded.sources_json,
                    model = excluded.model,
                    generated_at = excluded.generated_at
            `).run(
                String(calibreBookId),
                String(bookTitle),
                String(summary),
                JSON.stringify(sources),
                String(model || 'unknown'),
                generatedAt
            );
            return this.getBookSummary(calibreBookId);
        },

        close() {
            database.close();
        }
    };
}

module.exports = function openAiChatStore(databasePath = process.env.AI_CHAT_DB_PATH || path.resolve(__dirname, '..', 'data', 'ai-chat.sqlite')) {
    return createAiChatStore(databasePath);
};
module.exports.createAiChatStore = createAiChatStore;