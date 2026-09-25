SELECT *
  FROM books b,
       books_custom_column_1_link l,
       custom_column_1 c1,
       custom_column_5 c5
 WHERE b.id = l.book AND
       l.value = c1.id and
       b.id = c5.book;