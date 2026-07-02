const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer'); // 📬 Richiede installazione: npm install nodemailer

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    // 🎯 FIX: Corretto il metodo di risoluzione del percorso file
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

// 🔐 PIN DI SICUREZZA MASTER
const ADMIN_PIN = "9999";

// 📬 PARAMETRI CONFIGURAZIONE POSTA (SMTP HOSTINGER)
const MAIL_CONFIG = {
    host: "smtp.hostinger.com", 
    port: 465,
    secure: true, 
    auth: {
        user: "invio@tuodominio.com",      // ⚠️ Sostituisci con il tuo account email Hostinger reale
        pass: "tua_password_segreta"       // ⚠️ Sostituisci con la password reale della mail
    }
};

// 🎯 DESTINATARI UFFICIALI WABOTRADE
const EMAIL_DESTINATARIO = "info@wabotrade.com, amministrazione@wabotrade.com"; 

const transporter = nodemailer.createTransport(MAIL_CONFIG);

let haInviatoRiepilogoOggi = false;

// Funzione interna centralizzata per la spedizione delle email (protetta da try/catch per non bloccare SQL)
async function spedisciEmailHtml(soggetto, contenutoHtml) {
    try {
        await transporter.sendMail({
            from: `"Hub WaboTrade" <${MAIL_CONFIG.auth.user}>`,
            to: EMAIL_DESTINATARIO,
            subject: soggetto,
            html: contenutoHtml
        });
        console.log(`📧 Email inviata con successo a WaboTrade: ${soggetto}`);
    } catch (err) {
        console.error("❌ Errore critico durante l'invio della mail:", err);
    }
}

// Seeding automatico delle 10 referenze se il catalogo prodotti è vuoto
async function inizializzaCatalogoProdotti() {
    try {
        const [rows] = await pool.execute("SELECT COUNT(*) as totale FROM anagrafica_prodotti");
        if (rows[0].totale === 0) {
            const prodottiBase = [
                ["Olio Motore 5W30 1L", 14.90], ["Olio Motore 10W40 1L", 11.90],
                ["Liquido Lavavetri 4L", 5.50], ["AdBlue Tanica 5L", 9.90],
                ["Antigelo Radiatore 1L", 6.50], ["Profumatore Auto Assortito", 3.20],
                ["Spazzole Tergicristallo", 18.00], ["Lucido Cruscotti Spray", 5.90],
                ["Panno Microfibra Auto", 2.50], ["Additivo Pulizia Iniettori", 8.90]
            ];
            for (let p of prodottiBase) {
                await pool.execute("INSERT INTO anagrafica_prodotti (descrizione, prezzo_default) VALUES (?, ?)", [p[0], p[1]]);
            }
            console.log("🌱 Catalogo prodotti base inizializzato con successo!");
        }
    } catch (err) {
        console.log("Database prodotti pronto (Anagrafica già presente).");
    }
}
setTimeout(inizializzaCatalogoProdotti, 3000);

function sommaContatori(dettagli) {
    const regex = /:\s*([\d.]+)/g; let match, somma = 0;
    while ((match = regex.exec(dettagli)) !== null) { somma += parseFloat(match[1]); }
    return somma;
}

function estraiLitriCarico(dettagli) {
    const matchCarico = dettagli.match(/Autobotte:\s*\+\s*([\d.]+)/) || dettagli.match(/\+\s*([\d.]+)/);
    let totaleNetto = matchCarico ? parseFloat(matchCarico[1]) : 0;
    const matchVar = dettagli.match(/Cali\/Eccedenze viaggio:\s*([+-]?[\d.]+)/);
    if (matchVar) { totaleNetto += parseFloat(matchVar[1]); }
    return totaleNetto;
}

// 2. [POST] Salva movimento Carburanti e calcola lo Sfrido
app.post('/api/salva_movimento', async (req, res) => {
    try {
        const { impianto, data_ora, operazione, carburante, dettagli, giacenza_reale } = req.body;
        if (!impianto || !operazione || !carburante) return res.status(400).json({ success: false, error: "Dati incompleti" });

        let erogato = 0, giacenza_teorica = null, sfrido = null;
        const g_reale = parseFloat(giacenza_reale || 0);

        if (operazione === "Chiusura Contatori") {
            const [lastRows] = await pool.execute(`SELECT giacenza_reale, dettagli, data_ora FROM movimenti WHERE impianto = ? AND carburante = ? AND operazione = 'Chiusura Contatori' ORDER BY data_ora DESC, id DESC LIMIT 1`);
            if (lastRows.length > 0) {
                const ultimaChiusura = lastRows[0];
                erogato = sommaContatori(dettagli) - sommaContatori(ultimaChiusura.dettagli);
                if (erogato < 0) erogato = 0;

                const [caricoRows] = await pool.execute(`SELECT dettagli FROM movimenti WHERE impianto = ? AND carburante = ? AND operazione = 'Carico Cisterna' AND data_ora > ?`, [impianto, carburante, ultimaChiusura.data_ora]);
                let totaleCarichi = 0;
                caricoRows.forEach(c => { totaleCarichi += estraiLitriCarico(c.dettagli); });

                giacenza_teorica = parseFloat(ultimaChiusura.giacenza_reale) + totaleCarichi - erogato;
                sfrido = g_reale - giacenza_teorica;
            } else {
                giacenza_teorica = g_reale; sfrido = 0; erogato = 0;
            }
        }

        const query = `INSERT INTO movimenti (impianto, data_ora, operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [result] = await pool.execute(query, [impianto, data_ora, operazione, carburante, dettagli, g_reale, erogato, giacenza_teorica, sfrido]);

        // 📬 NOTIFICA EMAIL AUTOMATICA: Carico Autobotte Carburante
        if(operazione === "Carico Cisterna") {
            let htmlCaricoCarb = `<div style="font-family:sans-serif; padding:15px; border:1px solid #28a745; border-radius:8px; max-width:600px;">
                <h2 style="color:#28a745; margin-top:0; text-transform:uppercase;">🚚 SCARICO AUTOBOTTE CARBURANTI</h2>
                <p><strong>Impianto:</strong> ${impianto}</p>
                <p><strong>Carburante:</strong> ${carburante}</p>
                <p><strong>Dettagli Tecnici:</strong> ${dettagli}</p>
            </div>`;
            await spedisciEmailHtml(`🚚 Scarico Autobotte Carburanti - Sede di ${impianto}`, htmlCaricoCarb);
        }

        res.status(200).json({ success: true, id: result.insertId });
    } catch (error) { console.error(error); res.status(500).json({ success: false, error: "Errore interno database" }); }
});

app.get('/api/movimenti/:impianto', async (req, res) => {
    try {
        const { impianto } = req.params;
        const [rows] = await pool.execute(`SELECT id, data_ora, operazione, carburante, dettagli, erogato, giacenza_teorica, giacenza_reale, sfrido FROM movimenti WHERE impianto = ? ORDER BY data_ora DESC, id DESC`, [impianto]);
        res.status(200).json({ success: true, data: rows });
    } catch (error) { res.status(500).json({ success: false, error: "Errore interno" }); }
});

app.get('/api/admin/consulta', async (req, res) => {
    try {
        const { pin, impianto, carburante, operazione, data_inizio, data_fine } = req.query;
        if (pin !== ADMIN_PIN) return res.status(403).json({ success: false, error: "Accesso negato." });
        let query = `SELECT * FROM movimenti WHERE 1=1`; const values = [];
        if (impianto) { query += ` AND impianto = ?`; values.push(impianto); }
        if (carburante) { query += ` AND carburante = ?`; values.push(carburante); }
        if (operazione) { query += ` AND operazione = ?`; values.push(operazione); }
        if (data_inizio) { query += ` AND data_ora >= ?`; values.push(data_inizio + " 00:00:00"); }
        if (data_fine) { query += ` AND data_ora <= ?`; values.push(data_fine + " 23:59:59"); }
        query += ` ORDER BY data_ora DESC, id DESC`;
        const [rows] = await pool.execute(query, values); res.status(200).json({ success: true, data: rows });
    } catch (error) { res.status(500).json({ success: false, error: "Errore interno" }); }
});

app.delete('/api/movimenti/:id', async (req, res) => {
    try {
        const { id } = req.params; const { pin } = req.body;
        if (pin !== ADMIN_PIN) return res.status(403).json({ success: false, error: "Negato." });
        await pool.execute(`DELETE FROM movimenti WHERE id = ?`, [id]); res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: "Errore interno" }); }
});

app.put('/api/movimenti/:id', async (req, res) => {
    try {
        const { id } = req.params; const { pin, operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido } = req.body;
        if (pin !== ADMIN_PIN) return res.status(403).json({ success: false, error: "Negato." });
        const query = `UPDATE movimenti SET operazione = ?, carburante = ?, dettagli = ?, giacenza_reale = ?, erogato = ?, giacenza_teorica = ?, sfrido = ? WHERE id = ?`;
        await pool.execute(query, [operazione, carburante, dettagli, giacenza_reale, erogato, giacenza_teorica, sfrido, id]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: "Errore interno" }); }
});

app.get('/api/catalogo_prodotti', async (req, res) => {
    try { const [rows] = await pool.execute("SELECT * FROM anagrafica_prodotti ORDER BY descrizione ASC"); res.status(200).json({ success: true, data: rows }); } 
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/catalogo_prodotti', async (req, res) => {
    try {
        const { pin, descrizione, prezzo_default } = req.body; if (pin !== ADMIN_PIN) return res.status(403).json({ success: false, error: "Negato" });
        await pool.execute("INSERT INTO anagrafica_prodotti (descrizione, prezzo_default) VALUES (?, ?)", [descrizione, prezzo_default]); res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/catalogo_prodotti/:id', async (req, res) => {
    try {
        const { id } = req.params; const { pin, descrizione, prezzo_default } = req.body; if (pin !== ADMIN_PIN) return res.status(403).json({ success: false, error: "Negato" });
        await pool.execute("UPDATE anagrafica_prodotti SET descrizione = ?, prezzo_default = ? WHERE id = ?", [descrizione, prezzo_default, id]); res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 🛒 BATCH INSERTS OTTIMIZZATO PER GESTIONE PRODOTTI E INVIO MAIL UNICHE ACCORPATE
app.post('/api/salva_prodotto', async (req, res) => {
    try {
        const payloadRaccolta = Array.isArray(req.body) ? req.body : [req.body];
        if (payloadRaccolta.length === 0) return res.status(400).json({ success: false, error: "Nessun dato" });

        const primoItem = payloadRaccolta[0];
        let tipoOpMail = "Inventario"; 
        let htmlTabellaRighe = "";
        let incassoShopTotale = 0;

        for (let item of payloadRaccolta) {
            const { impianto, data_ora, descrizione, prezzo, giacenza_ieri, carico_oggi, spostati_in, spostati_out, giacenza_stasera, venduto } = item;
            
            const query = `INSERT INTO registro_prodotti (impianto, data_ora, descrizione, prezzo, giacenza_ieri, carico_oggi, spostati_in, spostati_out, giacenza_stasera, venduto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await pool.execute(query, [impianto, data_ora, descrizione, prezzo, giacenza_ieri, carico_oggi, spostati_in, spostati_out, giacenza_stasera, venduto]);

            if (carico_oggi > 0) {
                tipoOpMail = "Carico Fornitore Shop";
                htmlTabellaRighe += `<tr><td style="padding:8px; border-bottom:1px solid #ddd;">${descrizione}</td><td style="padding:8px; border-bottom:1px solid #ddd; text-align:center; color:#28a745; font-weight:bold;">+${carico_oggi} pz</td></tr>`;
            } else if (spostati_out > 0 || spostati_in > 0) {
                tipoOpMail = "Trasferimento Merce Shop";
                htmlTabellaRighe += `<tr><td style="padding:8px; border-bottom:1px solid #ddd;">${descrizione}</td><td style="padding:8px; border-bottom:1px solid #ddd; text-align:center; font-weight:bold;">${spostati_out > 0 ? 'USCITA 🔴 ' + spostati_out : 'INGRESSO 🟢 ' + spostati_in} pz</td></tr>`;
            } else {
                tipoOpMail = "Chiusura Serale Shop";
                if (parseInt(venduto) > 0) {
                    incassoShopTotale += (parseInt(venduto) * parseFloat(prezzo));
                    htmlTabellaRighe += `<tr><td style="padding:8px; border-bottom:1px solid #ddd;">${descrizione}</td><td style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">${giacenza_ieri} pz</td><td style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">${giacenza_stasera} pz</td><td style="padding:8px; border-bottom:1px solid #ddd; text-align:center; color:#e67e22; font-weight:bold;">${venduto} pz</td></tr>`;
                }
            }
        }

        let coloreBordo = tipoOpMail === "Carico Fornitore Shop" ? "#28a745" : (tipoOpMail === "Trasferimento Merce Shop" ? "#007bff" : "#e67e22");
        let htmlMailShop = `<div style="font-family:sans-serif; padding:15px; border:2px solid ${coloreBordo}; border-radius:8px; max-width:600px;">
            <h2 style="color:${coloreBordo}; margin-top:0; text-transform:uppercase;">🛒 MOVIMENTO SHOP WABOTRADE: ${tipoOpMail}</h2>
            <p><strong>Sede Operativa:</strong> ${primoItem.impianto}</p>
            <p><strong>Data/Ora Invio:</strong> ${new Date(primoItem.data_ora).toLocaleString('it-IT')}</p>
            <table style="width:100%; border-collapse:collapse; margin-top:15px;">`;

        if (tipoOpMail === "Chiusura Serale Shop") {
            htmlMailShop += `<thead><tr style="background:#f8f9fa;"><th style="padding:8px; text-align:left;">Prodotto</th><th style="padding:8px;">Ieri</th><th style="padding:8px;">Stasera</th><th style="padding:8px;">Venduti</th></tr></thead><tbody>${htmlTabellaRighe || '<tr><td colspan="4" style="text-align:center; padding:10px; color:#6c757d;">Nessun prodotto venduto oggi.</td></tr>'}</tbody></table>
            <h3 style="margin-top:20px; background:#fef5e7; padding:10px; border-radius:6px; color:#d35400;">💰 INCASSO SHOP PREVISTO: € ${incassoShopTotale.toFixed(2)}</h3>`;
        } else {
            htmlMailShop += `<thead><tr style="background:#f8f9fa;"><th style="padding:8px; text-align:left;">Prodotto</th><th style="padding:8px;">Quantità</th></tr></thead><tbody>${htmlTabellaRighe}</tbody></table>`;
        }
        htmlMailShop += `</div>`;

        await spedisciEmailHtml(`🛒 ${tipoOpMail} - Impianto ${primoItem.impianto}`, htmlMailShop);
        res.status(200).json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/prodotti/:impianto', async (req, res) => {
    try {
        const { impianto } = req.params;
        const [rows] = await pool.execute("SELECT * FROM registro_prodotti WHERE impianto = ? ORDER BY data_ora DESC, id DESC", [impianto]);
        res.status(200).json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ==============================================================================
// ⏰ LOGICA DI CONTROLLO RIEPILOGO AUTOMATICO CRON NOTTURNO (23:00)
// ==============================================================================
const elencoImpianti = ["Casal dei Pazzi", "Portuense", "Annibaliano", "Giustiniana"];

async function controllaEDInviaRiepilogoGenerale4Impianti() {
    const oraAttuale = new Date().getHours();
    
    if (oraAttuale === 23 && !haInviatoRiepilogoOggi) {
        try {
            console.log("⏰ Avvio report automatico notturno consolidato WaboTrade...");
            const dataOggiStringa = new Date().toISOString().split('T')[0];

            let htmlRiepilogoCompleto4 = `<div style="font-family:sans-serif; max-width:700px; border:3px double #343a40; padding:20px; border-radius:10px;">
                <h2 style="text-align:center; color:#343a40; margin-top:0; border-bottom:2px solid #343a40; padding-bottom:8px;">📊 HUB RECONCILIAZIONE NOTTURNA CONSOLIDATA</h2>
                <p style="text-align:center; font-weight:bold; color:#6c757d;">Data Elaborazione: ${new Date().toLocaleDateString('it-IT')}</p>`;

            for (let stazione of elencoImpianti) {
                const [carbRows] = await pool.execute(`SELECT carburante, operazione, dettagli, erogato, sfrido FROM movimenti WHERE impianto = ? AND data_ora >= ?`, [stazione, dataOggiStringa + " 00:00:00"]);
                let txtCarbInfo = "";
                carbRows.forEach(c => {
                    if (c.operazione === "Chiusura Contatori") {
                        txtCarbInfo += `• <b>${c.carburante}</b>: Erogati ${parseFloat(c.erogato).toFixed(1)} L | Sfrido: <span style="color:${parseFloat(c.sfrido)>=0?'#28a745':'#dc3545'}; font-weight:bold;">${parseFloat(c.sfrido).toFixed(1)} L</span>br>`;
                    }
                });

                const [shopRows] = await pool.execute(`SELECT descrizione, venduto, prezzo FROM registro_prodotti WHERE impianto = ? AND data_ora >= ? AND venduto > 0`, [stazione, dataOggiStringa + " 00:00:00"]);
                let incassoShopStazione = 0; let pezziShopStazione = 0;
                shopRows.forEach(s => { pezziShopStazione += parseInt(s.venduto); incassoShopStazione += (parseInt(s.venduto) * parseFloat(s.prezzo)); });

                htmlRiepilogoCompleto4 += `<div style="margin-top:20px; padding:12px; background:#f8f9fa; border-radius:6px; border-left:5px solid #343a40;">
                    <h3 style="margin:0 0 10px 0; color:#212529; text-transform:uppercase;">📍 Impianto: ${stazione}</h3>
                    <p style="margin:4px 0;"><b>⛽ REPARTO CARBURANTI:</b></p>
                    <div style="font-size:0.9rem; padding-left:10px; color:#495057;">${txtCarbInfo || 'Nessuna chiusura contatori inserita oggi.'}</div>
                    <p style="margin:10px 0 4px 0;"><b>🛒 REPARTO SHOP & ARTICOLI:</b></p>
                    <div style="font-size:0.9rem; padding-left:10px; color:#495057;">Pezzi totalizzati: ${pezziShopStazione} pz | <b>Incasso Totale Shop: € ${incassoShopStazione.toFixed(2)}</b></div>
                </div>`;
            }

            htmlRiepilogoCompleto4 += `<p style="font-size:0.75rem; text-align:center; color:#999; margin-top:25px; border-top:1px solid #eee; padding-top:10px;">Hub Riconciliazione WaboTrade — Chiusura automatica delle ore 23:00</p></div>`;

            await spedisciEmailHtml(`📊 Riepilogo Notturno Consolidato - 4 Impianti`, htmlRiepilogoCompleto4);
            haInviatoRiepilogoOggi = true;
        } catch (error) { console.error("Errore report notturno:", error); }
    }

    if (oraAttuale === 0 && haInviatoRiepilogoOggi) { haInviatoRiepilogoOggi = false; }
}
// 🎯 FIX: Rimosso l'identificatore non dichiarato prima della funzione di callback
setInterval(controllaEDInviaRiepilogoGenerale4Impianti, 60000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log("🚀 Server Node.js attivo sulla porta " + PORT); });