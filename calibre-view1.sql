SELECT *
FROM books b
JOIN books_custom_column_1_link l ON b.id = l.book
JOIN custom_column_1 c1 ON l.value = c1.id
LEFT JOIN custom_column_5 c5 ON b.id = c5.book;   