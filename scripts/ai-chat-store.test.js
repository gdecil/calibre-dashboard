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
});