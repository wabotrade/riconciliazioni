const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path'); // <-- AGGIUNTO: Necessario per leggere i file della cartella

const app = express();
app.use(cors());
app.use(express.json()); // Permette al server di leggere i JSON in arrivo

// <-- AGGIUNTO: Dice al server che questa cartella contiene file visibili al pubblico
app.use(express.static(__dirname));

// <-- AGGIUNTO: Quando visiti il dominio principale, ti serve il file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Configurazione del Database MySQL (Aggiornata con i dati di Hostinger)
const dbConfig = {
    host: '127.0.0.1', 
    user: 'u404268549_ricon',
    // Prova a usare la variabile sicura, altrimenti usa la password in chiaro (CAMBIALA APPENA PUOI SUL DB!)
    password: process.env.DB_PASSWORD || 'Mdz7tsXD^3', 
    database: 'u404268549_ricon'
};

// Creiamo un "Pool" di connessioni per gestire più richieste contemporaneamente
const pool = mysql.createPool(dbConfig);

// --- FUNZIONI DI SUPPORTO MATEMATICO PER LO SFRIDO ---
// Estrae tutti i numeri dopo i due punti nei dettagli e li somma (es. "A1: 100 | B1: 200" -> 300)
function sommaContatori(dettagli) {
    const regex = /:\s*([\d.]+)/g;
    let match;
    let somma = 0;
    while ((match = regex.exec(dettagli)) !== null) {
        somma += parseFloat(match[1]);
    }
    return somma;
}

// Estrae la cifra del carico (es. "Autobotte: +5000 L" -> 5000)
function estraiLitriCarico(dettagli) {
    const match = dettagli.match(/\+\s*([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
}

// 2. [POST] La rotta API che riceve i dati dal Frontend, calcola lo sfrido e li SALVA
app.post('/api/salva_movimento', async (req, res) => {
    try {
        const { impianto, data_ora, operazione, carburante, dettagli, giacenza_reale } = req.body;

        // Controllo che i dati principali ci siano
        if (!impianto || !operazione || !carburante) {
            return res.status(400).json({ success: false, error: "Dati incompleti" });
        }

        let erogato = 0;
        let giacenza_teorica = null;
        let sfrido = null;
        const g_reale = parseFloat(giacenza_reale || 0);

        if (operazione === "Chiusura Contatori") {
            // 1. Cerca l'ultima chiusura registrata per lo stesso impianto e carburante
            const [lastRows] = await pool.execute(
                `SELECT giacenza_reale, dettagli, data_ora FROM movimenti 
                 WHERE impianto = ? AND carburante = ? AND operazione = 'Chiusura Contatori' 
                 ORDER BY data_ora DESC, id DESC LIMIT 1`,
                [impianto, carburante]
            );

            if (lastRows.length > 0) {
                const ultimaChiusura = lastRows[0];
                
                // 2. Calcola l'erogato totale attuale rispetto alla chiusura precedente
                const contatoriAttuali = sommaContatori(dettagli);
                const contatoriPrecedenti = sommaContatori(ultimaChiusura.dettagli);
                erogato = contatoriAttuali - contatoriPrecedenti;
                if (erogato < 0) erogato = 0; // Sicurezza per evitare erogazioni negative

                // 3. Recupera eventuali carichi di autobotte arrivati DOPO l'ultima chiusura
                const [caricoRows] = await pool.execute(
                    `SELECT dettagli FROM movimenti 
                     WHERE impianto = ? AND carburante = ? AND operazione = 'Carico Cisterna' 
                     AND data_ora > ?`,
                    [impianto, carburante, ultimaChiusura.data_ora]
                );

                let totaleCarichi = 0;
                caricoRows.forEach(c => {
                    totaleCarichi += estraiLitriCarico(c.dettagli);
                });

                // 4. Calcola la Giacenza Teorica e lo Sfrido
                giacenza_teorica = parseFloat(ultimaChiusura.giacenza_reale) + totaleCarichi - erogato;
                sfrido = g_reale - giacenza_teorica;
            } else {
                // Se è la riga di partenza (Apertura anno), non c'è un passato: lo sfrido è 0
                giacenza_teorica = g_reale;
                sfrido = 0;
                erogato = 0;
            }
        }

        // Query SQL preparata e aggiornata con i campi di calcolo
        const query = `
            INSERT INTO movimenti 
            (impianto, data_ora, operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [impianto, data_ora, operazione, carburante, dettagli, g_reale, erogato, giacenza_teorica, sfrido];

        // Esegue la query di inserimento
        const [result] = await pool.execute(query, values);

        res.status(200).json({ success: true, message: "Salvato in MySQL con calcolo Sfrido!", id: result.insertId });

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
            ORDER BY data_ora DESC, id DESC
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