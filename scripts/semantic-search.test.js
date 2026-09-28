const { groupSearchResults } = require('../services/semantic-search');

describe('groupSearchResults', () => {
    test('raggruppa per book_id e conserva gli estratti migliori', () => {
        const results = groupSearchResults([
            { id: 10, book_id: 1, book_title: 'Libro A', score: 0.92, text: 'Estratto A1' },
            { id: 11, book_id: 1, book_title: 'Libro A', score: 0.88, text: 'Estratto A2' },
            { id: 20, book_id: 2, book_title: 'Libro B', score: 0.85, text: 'Estratto B1' },
            { id: 12, book_id: 1, book_title: 'Libro A', score: 0.80, text: 'Estratto A3' }
        ], { limit: 2, excerptsPerBook: 2 });

        expect(results).toHaveLength(2);
        expect(results[0].book_title).toBe('Libro A');
        expect(results[0].score).toBe(0.92);
        expect(results[0].excerpts.map((excerpt) => excerpt.text)).toEqual(['Estratto A1', 'Estratto A2']);
        expect(results[1].book_title).toBe('Libro B');
    });

    test('usa titolo e autori come fallback e non unisce chunk senza identità libro', () => {
        const results = groupSearchResults([
            { id: 1, book_title: 'Titolo', authors: ['Autore'], score: 0.9 },
            { id: 2, book_title: ' titolo ', authors: ['autore'], score: 0.8 },
            { id: 3, score: 0.7 },
            { id: 4, score: 0.6 }
        ]);

        expect(results).toHaveLength(3);
        expect(results[0].excerpts).toHaveLength(2);
        expect(results[1].excerpts).toHaveLength(1);
        expect(results[2].excerpts).toHaveLength(1);
    });

    test('mostra il numero capitolo al posto del nome file tecnico', () => {
        const [result] = groupSearchResults([
            {
                id: 1,
                book_id: 1,
                chapter_title: 'index_split_22.html',
                chapter_number: 15,
                score: 0.9
            },
            {
                id: 2,
                book_id: 2,
                chapter_title: 'Mnemonia',
                chapter_number: 3,
                score: 0.8
            }
        ]);

        expect(result.excerpts[0].chapter_title).toBe('Capitolo 15');
        expect(groupSearchResults([
            { id: 2, book_id: 2, chapter_title: 'Mnemonia', chapter_number: 3, score: 0.8 }
        ])[0].excerpts[0].chapter_title).toBe('Mnemonia');
    });
});