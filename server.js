const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Permette al server di leggere i JSON in arrivo

// 1. Configurazione del Database MySQL (Aggiornata con i dati di Hostinger)
const dbConfig = {
    host: 'localhost', 
    user: 'u404268549_ricon',
    password: 'Mdz7tsXD^3', // <--- Metti qui la nuova password che hai impostato su Hostinger!
    database: 'u404268549_ricon'
};

// Creiamo un "Pool" di connessioni per gestire più richieste contemporaneamente
const pool = mysql.createPool(dbConfig);

// 2. [POST] La rotta API che riceve i dati dal Frontend e li SALVA
app.post('/api/salva_movimento', async (req, res) => {
    try {
        const { impianto, data_ora, operazione, carburante, dettagli, giacenza_reale } = req.body;

        // Controllo che i dati principali ci siano
        if (!impianto || !operazione || !carburante) {
            return res.status(400).json({ success: false, error: "Dati incompleti" });
        }

        // Query SQL preparata
        const query = `
            INSERT INTO movimenti 
            (impianto, data_ora, operazione, carburante, dettagli, giacenza_reale) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const values = [impianto, data_ora, operazione, carburante, dettagli, giacenza_reale || 0];

        // Esegue la query di inserimento
        const [result] = await pool.execute(query, values);

        res.status(200).json({ success: true, message: "Salvato in MySQL!", id: result.insertId });

    } catch (error) {
        console.error("Errore salvataggio DB:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 3. [GET] Nuova rotta per RECUPERARE lo storico dati di un impianto e mostrarlo nelle tabelle
app.get('/api/movimenti/:impianto', async (req, res) => {
    try {
        const { impianto } = req.params;

        // Prende tutti i movimenti di quell'impianto dal più recente al più vecchio
        const query = `
            SELECT id, data_ora, operazione, carburante, dettagli, erogato, giacenza_teorica, giacenza_reale, sfrido 
            FROM movimenti 
            WHERE impianto = ? 
            ORDER BY data_ora DESC
        `;

        const [rows] = await pool.execute(query, [impianto]);

        res.status(200).json({ success: true, data: rows });

    } catch (error) {
        console.error("Errore recupero DB:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 4. Avvio del Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Node.js attivo sulla porta ${PORT}`);
});