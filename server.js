const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Permette al server di leggere i JSON in arrivo

// 1. Configurazione del Database MySQL
const dbConfig = {
    host: 'localhost',      // Sostituisci con l'host del tuo DB se non è in locale
    user: 'root',           // Il tuo utente MySQL
    password: 'tua_password', // La tua password MySQL
    database: 'registro_carburanti'
};

// 2. Creiamo un "Pool" di connessioni per gestire più richieste contemporaneamente
const pool = mysql.createPool(dbConfig);

// 3. La rotta API che riceve i dati dal Frontend
app.post('/api/salva_movimento', async (req, res) => {
    try {
        const { impianto, data_ora, operazione, carburante, dettagli, giacenza_reale } = req.body;

        // Controllo che i dati principali ci siano
        if (!impianto || !operazione || !carburante) {
            return res.status(400).json({ success: false, error: "Dati incompleti" });
        }

        // Query SQL preparata (previene gli attacchi SQL Injection)
        const query = `
            INSERT INTO movimenti 
            (impianto, data_ora, operazione, carburante, dettagli, giacenza_reale) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const values = [impianto, data_ora, operazione, carburante, dettagli, giacenza_reale || 0];

        // Esegue la query
        const [result] = await pool.execute(query, values);

        res.status(200).json({ success: true, message: "Salvato in MySQL!", id: result.insertId });

    } catch (error) {
        console.error("Errore DB:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 4. Avvio del Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Node.js attivo sulla porta ${PORT}`);
});