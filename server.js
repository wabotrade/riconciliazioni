const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json()); // Permette al server di leggere i JSON in arrivo

// Dice al server che questa cartella contiene file visibili al pubblico
app.use(express.static(__dirname));

// Quando visiti il dominio principale, ti serve il file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Configurazione del Database MySQL
const dbConfig = {
    host: '127.0.0.1', 
    user: 'u404268549_ricon',
    password: process.env.DB_PASSWORD || 'Mdz7tsXD^3', 
    database: 'u404268549_ricon'
};

const pool = mysql.createPool(dbConfig);

// 🔐 PIN DI SICUREZZA PER L'ELIMINAZIONE
const ADMIN_PIN = "9999";

// --- FUNZIONI DI SUPPORTO MATEMATICO ---
function sommaContatori(dettagli) {
    const regex = /:\s*([\d.]+)/g;
    let match;
    let somma = 0;
    while ((match = regex.exec(dettagli)) !== null) {
        somma += parseFloat(match[1]);
    }
    return somma;
}

function estraiLitriCarico(dettagli) {
    const match = dettagli.match(/\+\s*([\d.]+)/); // CORRETTO: rimosso il refuso "detalles ="
    return match ? parseFloat(match[1]) : 0;
}

// 2. [POST] Salva movimento e calcola lo Sfrido
app.post('/api/salva_movimento', async (req, res) => {
    try {
        const { impianto, data_ora, operazione, carburante, dettagli, giacenza_reale } = req.body;

        if (!impianto || !operazione || !carburante) {
            return res.status(400).json({ success: false, error: "Dati incompleti" });
        }

        let erogato = 0;
        let giacenza_teorica = null;
        let sfrido = null;
        const g_reale = parseFloat(giacenza_reale || 0);

        if (operazione === "Chiusura Contatori") {
            const [lastRows] = await pool.execute(
                `SELECT giacenza_reale, dettagli, data_ora FROM movimenti 
                 WHERE impianto = ? AND carburante = ? AND operazione = 'Chiusura Contatori' 
                 ORDER BY data_ora DESC, id DESC LIMIT 1`,
                [impianto, carburante]
            );

            if (lastRows.length > 0) {
                const ultimaChiusura = lastRows[0];
                const contatoriAttuali = sommaContatori(dettagli);
                const contatoriPrecedenti = sommaContatori(ultimaChiusura.dettagli);
                erogato = contatoriAttuali - contatoriPrecedenti;
                if (erogato < 0) erogato = 0;

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

                giacenza_teorica = parseFloat(ultimaChiusura.giacenza_reale) + totaleCarichi - erogato;
                sfrido = g_reale - giacenza_teorica;
            } else {
                giacenza_teorica = g_reale;
                sfrido = 0;
                erogato = 0;
            }
        }

        const query = `
            INSERT INTO movimenti 
            (impianto, data_ora, operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [impianto, data_ora, operazione, carburante, dettagli, g_reale, erogato, giacenza_teorica, sfrido];
        const [result] = await pool.execute(query, values);

        res.status(200).json({ success: true, message: "Salvato con successo!", id: result.insertId });

    } catch (error) {
        console.error("Errore salvataggio DB:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 3. [GET] Recupera lo storico dati completo
app.get('/api/movimenti/:impianto', async (req, res) => {
    try {
        const { impianto } = req.params;
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

// 4. [DELETE] Cancella un record errato previa verifica del PIN
app.delete('/api/movimenti/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        if (pin !== ADMIN_PIN) {
            return res.status(403).json({ success: false, error: "PIN di sicurezza errato! Autorizzazione negata." });
        }

        await pool.execute(`DELETE FROM movimenti WHERE id = ?`, [id]);
        res.status(200).json({ success: true, message: "Record eliminato correttamente." });

    } catch (error) {
        console.error("Errore cancellazione record:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 5. Avvio del Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Node.js attivo sulla porta ${PORT}`);
});