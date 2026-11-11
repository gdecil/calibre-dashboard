const { testDatabaseConnection } = require('./database');
(async () => {
    try {
        const success = await testDatabaseConnection();
        if (success) {
            console.log('✅ Database connesso con successo');
            process.exit(0);
        } else {
            console.error('❌ Errore connessione database');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Errore test database:', error.message);
        process.exit(1);
    }
})();
