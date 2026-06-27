let ultimiMovimentiCaricati = [];
let risultatiQueryAdmin = [];
let isAdminMode = false; 
let adminPin = "";       

function toggleVariazione(prefix) {
    const container = document.getElementById(`container_var_${prefix}`);
    if (container.style.display === 'none') {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
        document.getElementById(`var_viaggio_${prefix}`).value = ''; 
    }
}

function toggleAdminMode() {
    const btn = document.getElementById('adminToggleBtn');
    if (isAdminMode) {
        isAdminMode = false;
        adminPin = "";
        document.body.classList.remove('admin-mode-active');
        btn.classList.remove('active');
        btn.innerText = "🔒 Modalità Operatore";
        document.getElementById('tbl_risultati_query').innerHTML = '<tr><td colspan="5" style="text-align:center; color:#6c757d;">Seleziona i filtri e clicca su Elabora Report.</td></tr>';
        alert("Modalità Amministratore chiusa.");
    } else {
        const pin = prompt("🔐 ACCESSO RISERVATO\n\nInserisci il PIN amministrativo per sbloccare le funzioni di eliminazione e consultazione:");
        if (pin === null) return;

        if (pin === "9999") {
            isAdminMode = true;
            adminPin = pin;
            document.body.classList.add('admin-mode-active');
            btn.classList.add('active');
            btn.innerText = "🔓 Modalità Admin Attiva";
            alert("🔓 Accesso autorizzato. Pannello sbloccato in alto.");
        } else {
            alert("🚨 PIN inserito errato! Riprova.");
        }
    }
}

function eseguiConsultazioneAdmin() {
    if (!isAdminMode) return;
    const impianto = document.getElementById('q_impianto').value;
    const carburante = document.getElementById('q_carburante').value;
    const operazione = document.getElementById('q_operazione').value;
    const dataInizio = document.getElementById('q_inizio').value;
    const dataFine = document.getElementById('q_fine').value;

    let url = `/api/admin/consulta?pin=${adminPin}`;
    if(impianto) url += `&impianto=${encodeURIComponent(impianto)}`;
    if(carburante) url += `&carburante=${encodeURIComponent(carburante)}`;
    if(operazione) url += `&operazione=${encodeURIComponent(operazione)}`;
    if(dataInizio) url += `&data_inizio=${dataInizio}`;
    if(dataFine) url += `&data_fine=${dataFine}`;

    fetch(url)
    .then(res => res.json())
    .then(response => {
        if (!response.success) { alert("Errore consultazione: " + response.error); return; }
        const data = response.data;
        risultatiQueryAdmin = data;
        const tbody = document.getElementById('tbl_risultati_query');
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#dc3545;">Nessun record trovato.</td></tr>';
            document.getElementById('kpi_erogato').innerText = "0 L";
            document.getElementById('kpi_carichi').innerText = "0 L";
            document.getElementById('kpi_sfrido').innerText = "0 L";
            document.getElementById('kpi_var_viaggio').innerText = "0 L";
            return;
        }

        let totErogato = 0, totCarichi = 0, totSfrido = 0, totVarViaggio = 0;
        const chiusurePeriodo = data.filter(r => r.operazione === "Chiusura Contatori").sort((a,b) => new Date(a.data_ora) - new Date(b.data_ora));
        if (chiusurePeriodo.length >= 2) {
            totErogato = sommaContatori(chiusurePeriodo[chiusurePeriodo.length - 1].dettagli) - sommaContatori(chiusurePeriodo[0].dettagli);
        } else if (chiusurePeriodo.length === 1) {
            totErogato = parseFloat(chiusurePeriodo[0].erogato || 0);
        }

        data.forEach(row => {
            const dataFormattata = new Date(row.data_ora).toLocaleString('it-IT');
            let badgeClass = row.carburante === 'Diesel' ? 'badge-diesel' : (row.carburante === 'Diesel+' ? 'badge-dieselplus' : 'badge-benzina');
            if (row.operazione.includes("Carico")) badgeClass = "badge-carico";
            totSfrido += parseFloat(row.sfrido || 0);
            
            if (row.operazione === "Carico Cisterna") {
                const matchCarico = row.dettagli.match(/Autobotte:\s*\+\s*([\d.]+)/) || row.dettagli.match(/\+\s*([\d.]+)/);
                if (matchCarico) totCarichi += parseFloat(matchCarico[1]);
                const matchVar = row.dettagli.match(/Cali\/Eccedenze viaggio:\s*([+-]?[\d.]+)/);
                if (matchVar) totVarViaggio += parseFloat(matchVar[1]);
            }

            let sfridoTesto = row.sfrido !== null ? (parseFloat(row.sfrido) > 0 ? `<span style="color:#28a745; font-weight:bold;">+${parseFloat(row.sfrido).toFixed(1)} L</span>` : `<span style="color:#dc3545; font-weight:bold;">${parseFloat(row.sfrido).toFixed(1)} L</span>`) : '-';
            const bottoneModifica = `<button class="btn-modifica" onclick="modificaRecord(${row.id}, '${row.impianto}')">✏️ Modifica</button>`;
            const bottoneElimina = `<button class="btn-elimina" onclick="eliminaRecord(${row.id}, '${row.impianto}')">🗑️ Elimina</button>`;

            tbody.innerHTML += `<tr>
                <td>${dataFormattata}<br><small style="color:#6c757d; font-weight:bold;">${row.impianto}</small></td>
                <td><span class="badge ${badgeClass}">${row.carburante}</span><br><strong>${row.operazione}</strong></td>
                <td>${row.dettagli}</td><td>${sfridoTesto}</td><td>${bottoneModifica}${bottoneElimina}</td>
            </tr>`;
        });

        document.getElementById('kpi_erogato').innerText = `${totErogato.toFixed(1)} L`;
        document.getElementById('kpi_carichi').innerText = `${totCarichi.toFixed(1)} L`;
        document.getElementById('kpi_sfrido').innerText = `${totSfrido.toFixed(1)} L`;
        document.getElementById('kpi_var_viaggio').innerText = `${totVarViaggio.toFixed(1)} L`;
    }).catch(err => console.error(err));
}

function modificaRecord(id, impianto) {
    if (!isAdminMode) return;
    const row = risultatiQueryAdmin.find(r => r.id === id);
    if (!row) return;

    const nuovaOp = prompt("✏️ TIPO OPERAZIONE:", row.operazione); if (nuovaOp === null) return;
    const nuovoCarb = prompt("⛽ CARBURANTE:", row.carburante); if (nuovoCarb === null) return;
    const nuoviDettagli = prompt("📝 STRINGA CONTATORI:", row.dettagli); if (nuoviDettagli === null) return;
    const nuovaGiacReale = prompt("📊 GIACENZA REALE (L):", row.giacenza_reale); if (nuovaGiacReale === null) return;
    const nuovoErogato = prompt("🚀 LITRI EROGATI (L):", row.erogato || 0); if (nuovoErogato === null) return;
    const nuovaGiacTeorica = prompt("📉 GIACENZA TEORICA (L):", row.giacenza_teorica || 0); if (nuovaGiacTeorica === null) return;
    const nuovoSfrido = prompt("⚠️ SFRIDO (L):", row.sfrido || 0); if (nuovoSfrido === null) return;

    if (!confirm("Salvare le modifiche in SQL?")) return;

    fetch(`/api/movimenti/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pin: adminPin, operazione: nuovaOp, carburante: nuovoCarb, dettagli: nuoviDettagli,
            giacenza_reale: parseFloat(nuovaGiacReale), erogato: parseFloat(nuovoErogato),
            giacenza_teorica: parseFloat(nuovaGiacTeorica), sfrido: parseFloat(nuovoSfrido)
        })
    }).then(res => res.json()).then(resData => {
        if (resData.success) { alert("Modificato!"); eseguiConsultazioneAdmin(); loadDatabaseData(impianto); }
    }).catch(err => console.error(err));
}

function eliminaRecord(id, impianto) {
    if (!isAdminMode || !confirm("Eliminare definitivamente?")) return;
    fetch(`/api/movimenti/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPin })
    }).then(res => res.json()).then(data => {
        if (data.success) { alert("Rimosso!"); loadDatabaseData(impianto); if(isAdminMode) eseguiConsultazioneAdmin(); }
    }).catch(err => console.error(err));
}

function inviaAlDatabase(payload, mostraAlert = true) {
    fetch('/api/salva_movimento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(res => res.json()).then(data => {
        if(data.success && mostraAlert) { alert("Operazione registrata!"); loadDatabaseData(payload.impianto); }
    }).catch(err => console.error(err));
}

function loadDatabaseData(impianto) {
    fetch(`/api/movimenti/${encodeURIComponent(impianto)}`).then(res => res.json()).then(response => {
        if(!response.success) return;
        ultimiMovimentiCaricati = response.data;
        aggiornaContatoriGiacenza(impianto, response.data);
        const targetTbl = impianto === 'Casal dei Pazzi' ? 'tbl_diesel_casal' : (impianto === 'Annibaliano' ? 'tbl_diesel_ann' : (impianto === 'Giustiniana' ? 'tbl_diesel_giust' : 'tbl_generale_port'));
        
        if (impianto === 'Portuense') {
            riempiTabellaUnica(response.data, targetTbl, impianto);
        } else {
            const secondTbl = impianto === 'Casal dei Pazzi' ? 'tbl_benzina_casal' : (impianto === 'Annibaliano' ? 'tbl_benzina_ann' : 'tbl_benzina_giust');
            riempiTabellaSdoppiata(response.data, targetTbl, secondTbl, impianto);
        }
    }).catch(err => console.error(err));
}

function estraiContatorePrecedente(dettagli, nomePompa) {
    const regex = new RegExp(`${nomePompa}\\s*:\\s*([\\d.]+)`);
    const match = dettagli.match(regex);
    return match ? parseFloat(match[1]) : null;
}

function validaContatorePompa(carburante, nomePompa, nuovoValore) {
    nuovoValore = parseFloat(nuovoValore); if (isNaN(nuovoValore)) return true;
    const uChiusura = ultimiMovimentiCaricati.find(r => r.carburante === carburante && r.operazione.includes("Chiusura"));
    if (!uChiusura) return true;
    const vPrec = estraiContatorePrecedente(uChiusura.dettagli, nomePompa);
    if (vPrec === null) return true;
    if (nuovoValore < vPrec) { alert(`🚨 ERRORE - POMPA ${nomePompa} inferiore a ${vPrec}`); return false; }
    if (nuovoValore > vPrec + 2000 && !confirm(`⚠️ ANOMALIA - Forzare invio Pompa ${nomePompa}?`)) return false;
    return true;
}

function calcolaGiacenzaAttuale(carburante, data) {
    const idx = data.findIndex(r => r.carburante === carburante && r.operazione.includes("Chiusura"));
    if (idx === -1) return 0;
    let tot = parseFloat(data[idx].giacenza_reale || 0);
    for (let i = 0; i < idx; i++) {
        if (data[i].carburante === carburante && data[i].operazione.includes("Carico")) {
            const mC = data[i].dettagli.match(/Autobotte:\s*\+\s*([\d.]+)/) || data[i].dettagli.match(/\+\s*([\d.]+)/);
            if (mC) tot += parseFloat(mC[1]);
            const mV = data[i].dettagli.match(/Cali\/Eccedenze viaggio:\s*([+-]?[\d.]+)/);
            if (mV) tot += parseFloat(mV[1]);
        }
    }
    return tot.toFixed(1);
}

function aggiornaContatoriGiacenza(impianto, data) {
    document.getElementById(`stock_diesel_${impianto === 'Casal dei Pazzi'?'casal':(impianto==='Annibaliano'?'ann':(impianto==='Giustiniana'?'giust':'port'))}`).innerText = `${calcolaGiacenzaAttuale('Diesel', data)} L`;
    document.getElementById(`stock_benzina_${impianto === 'Casal dei Pazzi'?'casal':(impianto==='Annibaliano'?'ann':(impianto==='Giustiniana'?'giust':'port'))}`).innerText = `${calcolaGiacenzaAttuale('Benzina', data)} L`;
    if (impianto === 'Portuense') document.getElementById('stock_dieselplus_port').innerText = `${calcolaGiacenzaAttuale('Diesel+', data)} L`;
}

function sommaContatori(dettagli) {
    const regex = /:\s*([\d.]+)/g; let match, somma = 0;
    while ((match = regex.exec(dettagli)) !== null) { somma += parseFloat(match[1]); }
    return somma;
}

function verificaCaricoDimenticato(carburante, litriImmessiReali, contatoriAttualiSomma) {
    if (!ultimiMovimentiCaricati || ultimiMovimentiCaricati.length === 0) return true;
    const idx = ultimiMovimentiCaricati.findIndex(r => r.carburante === carburante && r.operazione.includes("Chiusura"));
    if (idx === -1) return true;
    const uCh = ultimiMovimentiCaricati[idx];
    const erog = Math.max(0, contatoriAttualiSomma - sommaContatori(uCh.dettagli));
    let tCarichi = 0;
    for (let i = 0; i < idx; i++) {
        if (ultimiMovimentiCaricati[i].carburante === carburante && ultimiMovimentiCaricati[i].operazione.includes("Carico")) {
            const mC = ultimiMovimentiCaricati[i].dettagli.match(/Autobotte:\s*\+\s*([\d.]+)/) || ultimiMovimentiCaricati[i].dettagli.match(/\+\s*([\d.]+)/);
            if (mC) tCarichi += parseFloat(mC[1]);
            const mV = ultimiMovimentiCaricati[i].dettagli.match(/Cali\/Eccedenze viaggio:\s*([+-]?[\d.]+)/);
            if (mV) tCarichi += parseFloat(mV[1]);
        }
    }
    const maxTeorico = parseFloat(uCh.giacenza_reale || 0) + tCarichi - erog;
    if (litriImmessiReali > (maxTeorico + 100)) { // 🎯 SOGLIA IMPOSTATA A 100 LITRI COME DA RICHIESTA
        alert(`🚨 BLOCCO DI SICUREZZA — Scarico Dimenticato o Litri Errati.\nMassimo stimato: ${maxTeorica.toFixed(1)} L.`);
        return false;
    }
    return true;
}

function riempiTabellaSdoppiata(data, idD, idB, imp) {
    const tD = document.getElementById(idD), tB = document.getElementById(idB);
    tD.innerHTML = ''; tB.innerHTML = '';
    data.forEach(row => {
        const dataFormattata = new Date(row.data_ora).toLocaleString('it-IT');
        const badge = row.operazione.includes("Carico") ? "badge-carico" : "badge-diesel";
        let sfr = row.sfrido !== null ? (parseFloat(row.sfrido) > 0 ? `<span style="color:#28a745; font-weight:bold;">+${parseFloat(row.sfrido).toFixed(1)} L</span>` : `<span style="color:#dc3545; font-weight:bold;">${parseFloat(row.sfrido).toFixed(1)} L</span>`) : '-';
        const btnE = `<button class="btn-elimina" onclick="eliminaRecord(${row.id}, '${imp}')">🗑️ Elimina</button>`;
        const tr = `<tr><td>${dataFormattata}</td><td><span class="badge ${badge}">${row.operazione}</span></td><td>${row.dettagli}</td><td>${sfr}</td><td>${btnE}</td></tr>`;
        if (row.carburante === 'Diesel') tD.innerHTML += tr;
        if (row.carburante === 'Benzina') tB.innerHTML += tr;
    });
}

function riempiTabellaUnica(data, idT, imp) {
    const t = document.getElementById(idT); t.innerHTML = '';
    data.forEach(row => {
        const dataFormattata = new Date(row.data_ora).toLocaleString('it-IT');
        let bCls = row.carburante === 'Diesel' ? 'badge-diesel' : (row.carburante === 'Diesel+' ? 'badge-dieselplus' : 'badge-benzina');
        if (row.operazione.includes("Carico")) bCls = "badge-carico";
        let sfr = row.sfrido !== null ? (parseFloat(row.sfrido) > 0 ? `<span style="color:#28a745; font-weight:bold;">+${parseFloat(row.sfrido).toFixed(1)} L</span>` : `<span style="color:#dc3545; font-weight:bold;">${parseFloat(row.sfrido).toFixed(1)} L</span>`) : '-';
        const btnE = `<button class="btn-elimina" onclick="eliminaRecord(${row.id}, '${imp}')">🗑️ Elimina</button>`;
        t.innerHTML += `<tr><td>${dataFormattata}</td><td><span class="badge ${bCls}">${row.operazione}</span></td><td>${row.dettagli}</td><td>${sfr}</td><td>${btnE}</td></tr>`;
    });
}

function inviaChiusura(event, impianto) {
    event.preventDefault(); const dOra = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (impianto === 'Casal dei Pazzi') {
        const cA1 = document.getElementById('c_A1_casal').value, cB1 = document.getElementById('c_B1_casal').value, rD = document.getElementById('stock_D_real_casal').value;
        const cA3 = document.getElementById('c_A3_casal').value, cB3 = document.getElementById('c_B3_casal').value, rB = document.getElementById('stock_B_real_casal').value;
        if (!validaContatorePompa("Diesel", "A1", cA1) || !validaContatorePompa("Diesel", "B1", cB1) || !validaContatorePompa("Benzina", "A3", cA3) || !validaContatorePompa("Benzina", "B3", cB3)) return;
        if (!verificaCaricoDimenticato("Diesel", parseFloat(rD), parseFloat(cA1)+parseFloat(cB1)) || !verificaCaricoDimenticato("Benzina", parseFloat(rB), parseFloat(cA3)+parseFloat(cB3))) return;
        if (!confirm("Inviare?")) return;
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Diesel", dettagli: `A1: ${cA1} | B1: ${cB1}`, giacenza_reale: rD }, false);
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Benzina", dettagli: `A3: ${cA3} | B3: ${cB3}`, giacenza_reale: rB }, true);
        event.target.reset();
    } else if (impianto === 'Portuense') {
        const c1 = document.getElementById('c_1_port').value, c4 = document.getElementById('c_4_port').value, c7 = document.getElementById('c_7_port').value, c10 = document.getElementById('c_10_port').value, rD1 = parseFloat(document.getElementById('stock_D1_real_port').value||0), rD2 = parseFloat(document.getElementById('stock_D2_real_port').value||0);
        const c2 = document.getElementById('c_2_port').value, c5 = document.getElementById('c_5_port').value, c8 = document.getElementById('c_8_port').value, c11 = document.getElementById('c_11_port').value, rDP = document.getElementById('stock_DP_real_port').value;
        const c3 = document.getElementById('c_3_port').value, c6 = document.getElementById('c_6_port').value, c9 = document.getElementById('c_9_port').value, c12 = document.getElementById('c_12_port').value, rB4 = parseFloat(document.getElementById('stock_B4_real_port').value||0), rB5 = parseFloat(document.getElementById('stock_B5_real_port').value||0);
        if (!validaContatorePompa("Diesel", "P1", c1) || !validaContatorePompa("Diesel", "P4", c4) || !validaContatorePompa("Diesel", "P7", c7) || !validaContatorePompa("Diesel", "P10", c10)) return;
        if (!validaContatorePompa("Diesel+", "P2", c2) || !validaContatorePompa("Diesel+", "P5", c5) || !validaContatorePompa("Diesel+", "P8", c8) || !validaContatorePompa("Diesel+", "P11", c11)) return;
        if (!validaContatorePompa("Benzina", "P3", c3) || !validaContatorePompa("Benzina", "P6", c6) || !validaContatorePompa("Benzina", "P9", c9) || !validaContatorePompa("Benzina", "P12", c12)) return;
        if (!verificaCaricoDimenticato("Diesel", rD1+rD2, parseFloat(c1)+parseFloat(c4)+parseFloat(c7)+parseFloat(c10))) return;
        if (!verificaCaricoDimenticato("Diesel+", parseFloat(rDP), parseFloat(c2)+parseFloat(c5)+parseFloat(c8)+parseFloat(c11))) return;
        if (!verificaCaricoDimenticato("Benzina", rB4+rB5, parseFloat(c3)+parseFloat(c6)+parseFloat(c9)+parseFloat(c12))) return;
        if (!confirm("Inviare?")) return;
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Diesel", dettagli: `P1:${c1} P4:${c4} P7:${c7} P10:${c10}`, giacenza_reale: rD1+rD2 }, false);
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Diesel+", dettagli: `P2:${c2} P5:${c5} P8:${c8} P11:${c11}`, giacenza_reale: rDP }, false);
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Benzina", dettagli: `P3:${c3} P6:${c6} P9:${c9} P12:${c12}`, giacenza_reale: rB4+rB5 }, true);
        event.target.reset();
    } else if (impianto === 'Annibaliano') {
        const c1 = document.getElementById('c_1_ann').value, c6 = document.getElementById('c_6_ann').value, rD = document.getElementById('stock_D_real_ann').value;
        const c3 = document.getElementById('c_3_ann').value, c8 = document.getElementById('c_8_ann').value, rB = document.getElementById('stock_B_real_ann').value;
        if (!validaContatorePompa("Diesel", "P1", c1) || !validaContatorePompa("Diesel", "P6", c6) || !validaContatorePompa("Benzina", "P3", c3) || !validaContatorePompa("Benzina", "P8", c8)) return;
        if (!verificaCaricoDimenticato("Diesel", parseFloat(rD), parseFloat(c1)+parseFloat(c6)) || !verificaCaricoDimenticato("Benzina", parseFloat(rB), parseFloat(c3)+parseFloat(c8))) return;
        if (!confirm("Inviare?")) return;
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Diesel", dettagli: `P1: ${c1} | P6: ${c6}`, giacenza_reale: rD }, false);
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Benzina", dettagli: `P3: ${c3} | P8: ${c8}`, giacenza_reale: rB }, true);
        event.target.reset();
    } else if (impianto === 'Giustiniana') {
        const c_T31 = document.getElementById('c_T31_giust').value, c_T41 = document.getElementById('c_T41_giust').value, price_D = document.getElementById('price_D_giust').value, rD = document.getElementById('stock_D_real_giust').value;
        const c_T33 = document.getElementById('c_T33_giust').value, c_T43 = document.getElementById('c_T43_giust').value, price_B = document.getElementById('price_B_giust').value, rB = document.getElementById('stock_B_real_giust').value;
        if (!validaContatorePompa("Diesel", "T3-1", c_T31) || !validaContatorePompa("Diesel", "T4-1", c_T41) || !validaContatorePompa("Benzina", "T3-3", c_T33) || !validaContatorePompa("Benzina", "T4-3", c_T43)) return;
        if (!verificaCaricoDimenticato("Diesel", parseFloat(rD), parseFloat(c_T31)+parseFloat(c_T41)) || !verificaCaricoDimenticato("Benzina", parseFloat(rB), parseFloat(c_T33)+parseFloat(c_T43))) return;

        const lastD = ultimiMovimentiCaricati.find(r => r.carburante === 'Diesel' && r.operazione.includes("Chiusura"));
        let erogD = (parseFloat(c_T31)+parseFloat(c_T41)) - (lastD ? sommaContatori(lastD.dettagli) : (parseFloat(c_T31)+parseFloat(c_T41)));
        let totD = Math.max(0, erogD) * parseFloat(price_D || 0);

        const lastB = ultimiMovimentiCaricati.find(r => r.carburante === 'Benzina' && r.operazione.includes("Chiusura"));
        let erogB = (parseFloat(c_T33)+parseFloat(c_T43)) - (lastB ? sommaContatori(lastB.dettagli) : (parseFloat(c_T33)+parseFloat(c_T43)));
        let totB = Math.max(0, erogB) * parseFloat(price_B || 0);

        if (!confirm(`Confirm Giustiniana:\nDiesel: ${erogD.toFixed(1)}L (€ ${totD.toFixed(2)})\nBenzina: ${erogB.toFixed(1)}L (€ ${totB.toFixed(2)})`)) return;

        let detD = `T3-1: ${c_T31} | T4-1: ${c_T41} - Prezzo vda ${price_D} €/L - Erogato ${erogD.toFixed(1)} L - Totale € ${totD.toFixed(2)}`;
        let detB = `T3-3: ${c_T33} | T4-3: ${c_T43} - Prezzo vda ${price_B} €/L - Erogato ${erogB.toFixed(1)} L - Totale € ${totB.toFixed(2)}`;
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Diesel", dettagli: detD, giacenza_reale: rD }, false);
        inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Chiusura Contatori", carburante: "Benzina", dettagli: detB, giacenza_reale: rB }, true);
        event.target.reset();
    }
}

function inviaCarico(event, impianto) {
    event.preventDefault(); const dOra = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let tCis = "", litri = 0, vVia = "", prf = "";
    if(impianto==='Casal dei Pazzi') { prf='casal'; tCis=document.getElementById('select_cisterna_casal').value; litri=document.getElementById('litri_carico_casal').value; vVia=document.getElementById('var_viaggio_casal').value; }
    if(impianto==='Portuense') { prf='port'; tCis=document.getElementById('select_cisterna_port').value; litri=document.getElementById('litri_carico_port').value; vVia=document.getElementById('var_viaggio_port').value; }
    if(impianto==='Annibaliano') { prf='ann'; tCis=document.getElementById('select_cisterna_ann').value; litri=document.getElementById('litri_carico_ann').value; vVia=document.getElementById('var_viaggio_ann').value; }
    if(impianto==='Giustiniana') { prf='giust'; tCis=document.getElementById('select_cisterna_giust').value; litri=document.getElementById('litri_carico_giust').value; vVia=document.getElementById('var_viaggio_giust').value; }

    if (!confirm(`Registrare Carico +${litri} L?`)) return;
    let det = `Autobotte: +${litri} L` + (vVia ? ` | Cali/Eccedenze viaggio: ${vVia} L` : '');
    inviaAlDatabase({ impianto, data_ora: dOra, operazione: "Carico Cisterna", carburante: tCis, dettagli: det, giacenza_reale: 0 }, true);
    event.target.reset(); if(prf) document.getElementById(`container_var_${prf}`).style.display = 'none';
}

document.addEventListener("DOMContentLoaded", () => {
    let auth = false, tab = "", imp = "", pin = "";
    while (!auth) {
        pin = prompt("🔐 INSERISCI PIN IMPIANTO:"); if (pin === null) return;
        if (pin === "1515") { tab = "annibaliano"; imp = "Annibaliano"; auth = true; }
        else if (pin === "7177") { tab = "portuense"; imp = "Portuense"; auth = true; }
        else if (pin === "9797") { tab = "casal"; imp = "Casal dei Pazzi"; auth = true; }
        else if (pin === "4545") { tab = "giustiniana"; imp = "Giustiniana"; auth = true; }
        else if (pin === "9999") { tab = "casal"; imp = "Casal dei Pazzi"; auth = true; }
        else { alert("PIN errato!"); }
    }
    document.body.style.display = 'block';
    if (pin !== "9999") {
        document.querySelectorAll('.tab-btn').forEach(b => { if(b.getAttribute('data-target')!==tab) b.style.display='none'; });
        if(document.getElementById('q_impianto')) { document.getElementById('q_impianto').value = imp; document.getElementById('q_impianto').disabled = true; }
    }
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => content = c.classList.remove('active'));
    if(document.querySelector(`.tab-btn[data-target="${tab}"]`)) document.querySelector(`.tab-btn[data-target="${tab}"]`).classList.add('active');
    if(document.getElementById(tab)) document.getElementById(tab).classList.add('active');
    loadDatabaseData(imp);
});