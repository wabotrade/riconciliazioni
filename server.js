const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Configurazione del Database MySQL
const dbConfig = {
    host: '127.0.0.1', 
    user: 'u404268549_ricon',
    password: process.env.DB_PASSWORD || 'Mdz7XD^3', 
    database: 'u404268549_ricon'
};

const pool = mysql.createPool(dbConfig);

// 🔐 PIN DI SICUREZZA MASTER
const ADMIN_PIN = "9999";

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
    const matchCarico = dettagli.match(/Autobotte:\s*\+\s*([\d.]+)/) || dettagli.match(/\+\s*([\d.]+)/);
    let totaleNetto = matchCarico ? parseFloat(matchCarico[1]) : 0;

    const matchVar = dettagli.match(/Cali\/Eccedenze viaggio:\s*([+-]?[\d.]+)/);
    if (matchVar) {
        totaleNetto += parseFloat(matchVar[1]);
    }
    return totaleNetto;
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

// 3. [GET] Storico ordinario
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

// 🔍 4. [GET] Consultazione Avanzata Admin (SQL Filtri Dinamici)
app.get('/api/admin/consulta', async (req, res) => {
    try {
        const { pin, impianto, carburante, operazione, data_inizio, data_fine } = req.query;

        if (pin !== ADMIN_PIN) {
            return res.status(403).json({ success: false, error: "Accesso negato. PIN errato." });
        }

        let query = `SELECT * FROM movimenti WHERE 1=1`;
        const values = [];

        if (impianto) { query += ` AND impianto = ?`; values.push(impianto); }
        if (carburante) { query += ` AND carburante = ?`; values.push(carburante); }
        if (operazione) { query += ` AND operazione = ?`; values.push(operazione); }
        if (data_inizio) { query += ` AND data_ora >= ?`; values.push(data_inizio + " 00:00:00"); }
        if (data_fine) { query += ` AND data_ora <= ?`; values.push(data_fine + " 23:59:59"); }

        query += ` ORDER BY data_ora DESC, id DESC`;

        const [rows] = await pool.execute(query, values);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Errore query consultazione:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

// 🚨 5. [DELETE] Rimosso record errato
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

// 🚨 6. [PUT] Modifica analitica di un record esistente (Pannello Admin)
app.put('/api/movimenti/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin, operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido } = req.body;

        if (pin !== ADMIN_PIN) {
            return res.status(403).json({ success: false, error: "PIN di sicurezza errato! Autorizzazione negata." });
        }

        const query = `
            UPDATE movimenti 
            SET operazione = ?, carburante = ?, dettagli = ?, giacenza_reale = ?, erogato = ?, giacenza_teorica = ?, sfrido = ?
            WHERE id = ?
        `;
        const values = [operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido, id];
        await pool.execute(query, values);

        res.status(200).json({ success: true, message: "Record modificato correttamente nel database." });
    } catch (error) {
        console.error("Errore durante la modifica del record SQL:", error);
        res.status(500).json({ success: false, error: "Errore interno del server" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 Server Node.js attivo sulla porta " + PORT);
});