const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAiChatStore } = require('../services/ai-chat-store');

describe('AI chat store', () => {
    let directory;
    let databasePath;
    let store;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calibre-ai-chat-'));
        databasePath = path.join(directory, 'chat.sqlite');
        store = createAiChatStore(databasePath);
    });

    afterEach(() => {
        if (store) store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test('persists turns and cited sources when reopened', () => {
        const id = store.createConversation('Domanda di prova');
        const sources = [{ citation: 'C1', book_title: 'Libro', excerpt: 'Passaggio' }];
        store.saveTurn(id, 'Che cosa accade?', 'Il personaggio parte [C1].', sources);
        store.close();

        store = createAiChatStore(databasePath);
        const conversation = store.getConversation(id);

        expect(conversation.title).toBe('Domanda di prova');
        expect(conversation.messages).toHaveLength(2);
        expect(conversation.messages[0]).toMatchObject({ role: 'user', content: 'Che cosa accade?' });
        expect(conversation.messages[1]).toMatchObject({
            role: 'assistant',
            content: 'Il personaggio parte [C1].',
            sources
        });
        expect(store.listConversations()[0].message_count).toBe(2);
    });

    test('deletes a conversation and its messages', () => {
        const id = store.createConversation('Da eliminare');
        store.saveTurn(id, 'Domanda', 'Risposta', []);

        expect(store.deleteConversation(id)).toBe(true);
        expect(store.getConversation(id)).toBeNull();
        expect(store.listConversations()).toHaveLength(0);
    });

    test('persists book summaries by Calibre ID and replaces older versions', () => {
        const sources = [{ citation: 'C1', chapter_title: 'Capitolo 3', excerpt: 'Un passaggio' }];
        store.saveBookSummary('24614', 'La rabbia degli angeli', 'Prima sintesi [C1].', sources, 'qwen3:14b');
        store.close();

        store = createAiChatStore(databasePath);
        expect(store.getBookSummary('24614')).toMatchObject({
            calibre_book_id: '24614',
            book_title: 'La rabbia degli angeli',
            summary: 'Prima sintesi [C1].',
            sources,
            model: 'qwen3:14b'
        });

        const updated = store.saveBookSummary('24614', 'La rabbia degli angeli', 'Sintesi aggiornata [C1].', sources, 'qwen3:14b');
        expect(updated.summary).toBe('Sintesi aggiornata [C1].');
        expect(updated.sources).toEqual(sources);
    });
});