# Changelog

## 3.5.1 — 2026-10-03

- Corretto il blocco dell’updater quando un PID precedente è stato riutilizzato: confronta l’avvio del processo con la data del lock e archivia solo un lock certamente obsoleto e il suo record corrispondente. Non termina il nuovo processo e conserva profilo e record.
- Chiusura tramite handshake dell’istanza registrata anche per avvii npm con percorso relativo, oltre alla ricerca delle copie installate. Verifica proprietario, sessione, PID della porta e instanceId; le operazioni note in corso impediscono anche force.
- Corretto il passaggio del profilo con `--force`, che prima poteva diventare il percorso del profilo. Errori controllati su stdout JSON e codifica UTF-8 esplicita per evitare l’interruzione prematura di PowerShell 5.1 su stderr.
- L’errore del lock ora riporta PID e nome del processo per poter diagnosticare un caso ancora bloccato. Nessuna Action o build Windows automatica.

## 3.5.0 — 2026-10-03

- Aggiornamenti applicativi ZIP verificati da SHA-256 e manifest, senza compilare un nuovo EXE e senza Actions. Runtime, dipendenze e profilo esistenti vengono riutilizzati; ripristino automatico se la verifica di avvio fallisce.
- `Aggiorna-GWB.cmd` migra le installazioni precedenti con un solo file. Se manca il pacchetto iniziale, scarica il Setup 3.4.5 con checksum fissato; da allora si aggiorna dal pulsante nell’app.
- Chiusura delle istanze precedenti tramite percorso verificato, proprietario, sessione e identità del processo: anche copie senza instance.json e launcher orfani. I server inattivi ricevono una richiesta di chiusura; quelli non responsivi richiedono conferma prima della terminazione forzata. Operazioni note in corso bloccano sempre la chiusura.
- Pulsante «Chiudi vecchie istanze»; protegge l’istanza corrente e i suoi launcher, senza terminare Node o browser estranei.
- Workflow Windows esclusivamente manuale. Il canale stabile nel repository distribuisce ZIP racchiusi in JSON testuale e riferiti tramite blob Git immutabile: non è una nuova Release EXE. Le future modifiche a runtime/dipendenze richiedono un nuovo pacchetto iniziale e un collaudo Windows espliciti.
- Test locali Linux con fixture. Il nuovo bootstrap e gli adattatori Windows richiedono ancora una prova nativa su Windows; non è stata consumata una Action per questo collaudo.

## 3.4.5 — 2026-10-03

- Il Setup offre «Chiudi l’app e continua» quando la versione precedente è aperta e inattiva. Richiede la chiusura al server locale, attende Node e launcher e prosegue l’aggiornamento; «Annulla aggiornamento» lascia aperta l’app.
- Backup e pubblicazioni in corso bloccano la chiusura e l’aggiornamento. Processi non verificabili, blocchi corrotti e chiusure non concluse restano bloccati: nessuna terminazione forzata o ricerca generica di tutti i processi Node.
- Il controllo verifica PID, inventario dell’istanza e risposta del server locale senza proxy. Dati, token e backup restano nel profilo esistente. Le installazioni silenziose non chiudono l’app automaticamente; la protezione della disinstallazione è mantenuta.
- Il collaudo Windows verifica il pulsante nel Setup reale, l’upgrade dalla 3.4.3 lasciata aperta, il blocco durante una scrittura e la conservazione dei dati. Verifica anche PID estranei e blocchi corrotti/obsoleti.

## 3.4.3 — 2026-10-02

- Eliminata la sesta pagina «Trigger ed esecuzioni» e la raccolta diagnostica separata. Le impostazioni Cloud, l’inventario e il piano trigger sono nelle opzioni del Backup; esecuzioni e trigger restano selezionabili nello stesso ZIP.
- Dopo un backup completato si apre «Modifiche AI». Errori e annullamenti restano nel Backup; «Risultati» si apre dal menu.
- Actions limitate ai cambiamenti di `package.json` su `main` per le nuove versioni e agli avvii manuali. Nessuna build automatica su PR, commit ordinari o tag. Cache npm mantenuta, artefatti temporanei per 3 giorni e upload senza ricompressione.
- Aggiunte istruzioni Copilot brevi, basate sui principi pertinenti di Awesome Copilot e della guida di sicurezza fornita. Nessun servizio AI o dipendenza aggiunto al programma.
- Il test browser verifica le cinque sezioni, le impostazioni nel Backup e la navigazione dopo successo, errori parziali, errore e annullamento. Il collaudo installer prova l’upgrade reale dalla 3.4.2 e la conservazione dei dati.

## 3.4.2 — 2026-10-02

- Mantiene le opzioni ZIP e le impostazioni persistenti della 3.4.1: ID esistenti, esecuzioni e inventario trigger salvato riutilizzabili senza reinserirli.
- La pubblicazione specifica il tag in ogni aggiornamento REST e verifica tag e stato anche nella risposta finale. Non considera completata una release pubblicata con un’etichetta provvisoria.
- Corretta l’etichetta della Release 3.4.1 senza sostituirne i file o cambiarne il commit.
- 43 test automatici, incluso il caso di risposta con un tag inatteso. Il collaudo Windows verifica l’upgrade dalla 3.4.0 preservando dati e impostazioni; le API Google sono simulate.

## 3.4.1 — 2026-10-02

- Aggiunte al normale backup le opzioni indipendenti «Includi esecuzioni» e «Includi inventario trigger salvato», con periodo 1/7/30 giorni. I dati scelti finiscono nello stesso ZIP per l’AI.
- Gli ID Foglio e Apps Script restano quelli del progetto già salvato; ID Cloud, chiave script, preferenze e inventario trigger sono memorizzati per progetto. La raccolta manuale salva anche le sue impostazioni.
- Il JSON trigger viene salvato una volta e riutilizzato, con data e indicazione esplicita che è una copia salvata. Per aggiornare l’inventario occorre una nuova esportazione da Apps Script: non viene presentato come una lettura live.
- Un errore nei permessi diagnostici non elimina il backup: lo ZIP contiene un avviso esplicito. Log Cloud mancanti o mal configurati non fanno perdere le esecuzioni già raccolte.
- I token riconoscibili nei file diagnostici vengono censurati nella copia ZIP per l’AI; i dati originali restano nel backup locale.
- La pubblicazione usa l’ID della risposta di creazione della bozza, senza attendere che compaia nell’elenco delle release. Modifiche e upload usano lo stesso ID; i checksum vengono verificati prima della pubblicazione.
- 42 test automatici superati. Aggiunto al collaudo Windows l’upgrade dalla Release pubblica 3.4.0 con verifica degli ID, delle impostazioni e dei dati conservati. Le API Google sono simulate nei test.

## 3.4.0 — 2026-10-01

### Installer e Release

- Un unico Setup Windows x64 con Node.js e dipendenze inclusi, avvio a fine installazione e dati personali conservati negli aggiornamenti.
- Pubblicazione automatica della Release dopo build, controlli e smoke test Windows. PR: solo controlli, senza pubblicazione.
- EXE, ZIP sorgente e SHA-256 pubblicati insieme; la Release resta in bozza fino alla verifica degli asset.
- Pulsante Controlla aggiornamenti con link al repository ufficiale, senza esecuzione automatica di file scaricati.

### Trigger ed esecuzioni

- Nuova pagina per scaricare 1, 7 o 30 giorni di esecuzioni, CSV, JSON e riepilogo per funzione.
- Conteggio errori, timeout, attese per quota, durata massima/media e avvii automatici fuori 20:00–08:30 Europe/Rome.
- Log Cloud con messaggi e stack, quando accessibili; versioni e deployment con avvisi per dati parziali o non autorizzati.
- Consenso diagnostica separato; mantiene i permessi già concessi di pubblicazione.
- Piano per creare, sostituire e rimuovere trigger orari selezionati, con preset notturno del gestionale e copia di sicurezza dei sorgenti.
- Applicazione manuale con gwbApplyTriggerPlan nell’editor Apps Script: Google non permette la creazione dei trigger via API. Ripresa delle regole incomplete senza rifare quelle completate.
- Inventario dei trigger tramite gwbExportTriggers. Gli orari dei trigger di altri installer non sono esposti da Google.

### Verifiche

- 36 test automatici locali superati; API Google e trigger simulati, senza credenziali reali. Collaudo Windows dell’installer e dell’interfaccia superato.
- Corrette due versioni transitive di brace-expansion segnalate dal controllo npm.
- Installer non firmato digitalmente. Configurazione OAuth e autorizzazione Google iniziale restano necessarie.

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
