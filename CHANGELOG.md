# Changelog

## 3.3.2 — 2026-09-07

### Accesso Google

- Mostra nell'interfaccia un link diretto al consenso Google se il browser non si apre automaticamente.
- Il pulsante “Scollega” diventa “Annulla e scollega” durante il login e resta utilizzabile.
- L'annullamento chiude subito il callback OAuth, invalida il tentativo corrente e rimuove token e file temporanei locali.
- Un tentativo abbandonato non blocca più i successivi collegamenti fino al timeout.
- Aggiunti test automatici per URL alternativo, annullamento e pulizia del login.

## 3.3.1 — 2026-09-06

### Distribuzione

- Sorgente Inno Setup per Windows x64, installazione per utente e collegamenti Start/Desktop.
- Node.js privato fissato in build con controllo SHA-256; dipendenze tramite npm ci.
- Launcher grafico compilabile con .NET Framework, senza Electron o framework frontend.
- Build pulita, manifesto dei file, controllo pre-installer, ZIP sorgente e checksum.
- Workflow GitHub Windows per compilazione e prove automatiche; pubblicazione Release manuale.
- Versione applicativa letta da package.json; eliminato VERSION.txt duplicato.

### Correzioni e sicurezza

- Porta alternativa automatica se quella storica è occupata.
- Singola istanza per profilo, riuso dell'interfaccia e nessuna terminazione forzata della versione precedente.
- Host/Origin e richieste cross-site controllati sul server locale.
- Blocco di chiusura/modifiche sovrapposte durante operazioni.
- Stato corrotto conservato, con errore esplicito all'avvio.
- Callback OAuth solo loopback, state, PKCE, timeout e lettura aggiornata del JSON credenziali.
- Primo login in sola lettura; nuovo consenso esplicito per la pubblicazione, con controllo account.
- Rimozione della dipendenza local-auth sostituita dal piccolo callback locale basato sul client Google già presente.
- Blocco percorsi AI con nomi riservati Windows o sintassi alternate data stream.
- Controllo hash tra scansione privacy e creazione ZIP.
- Token di test costruiti dinamicamente e placeholder aziendale generalizzato.
- .gitignore esteso, controllo sorgenti e documentazione sicurezza/licenza.

### Compatibilità e limiti

- Motore, frontend, formati backup e pacchetto AI conservati.
- Token DPAPI, profilo v3 e cartelle backup esistenti mantenuti.
- Nessun updater automatico e nessuna estensione Chrome implementati.
- Questo ambiente non ha compilato o eseguito il Setup Windows; vedi docs/TEST_REPORT.md.

## 3.3.0 — versione di partenza

Privacy con livelli di confidenza e anteprime, note/commenti, diagnostica account, lettura a blocchi, token Windows DPAPI, avanzamento/annullamento e dipendenze aggiornate. Le note storiche precedenti sono conservate in NOTE_VERSIONE.txt.
