# Architettura e analisi della versione originale

## Struttura mantenuta

| Componente | Responsabilità |
| --- | --- |
| `server.mjs` | HTTP locale, stato, configurazione, job backup, preview/import AI, pubblicazione |
| `engine.mjs` | API Google, snapshot Sheets, note/commenti, export Apps Script/XLSX/ZIP, segreti e protezioni |
| `public/index.html`, `public/app.js`, `public/style.css` | Interfaccia HTML/JS/CSS senza framework |
| `launcher.ps1` | Avvio Windows, controllo runtime, mutex e log |
| `Avvia.vbs`, `Avvia_visibile.bat` | Avvii sorgente compatibili con il pacchetto precedente |
| `installer/Launcher.cs` | Piccolo eseguibile grafico che richiama il launcher PowerShell |
| `oauth.mjs` | Callback OAuth Desktop con protezioni, usando il client Google esistente |
| `instance.mjs` | Proprietà esclusiva del profilo e descrittore della porta |
| `browser.mjs` | Apertura browser senza interpolazione della URL in cmd.exe |
| `scripts/` | Build, controllo sorgente, runtime fissato, installer e ZIP |

Non sono stati introdotti Electron, React, database, Docker o servizi di backend esterni.

## Analisi 3.3.0

Tutti i file del pacchetto originale sono stati letti, inclusi launcher, motore, server, frontend, manifest npm e documentazione. Il lock npm è stato verificato tramite installazione bloccata e audit; non è stato riscritto il motore di backup.

Dati già separati: credenziali, token DPAPI e stato in `%APPDATA%\GoogleWorkspaceBackup`; backup in Downloads o percorso scelto. Log job in memoria e log di errore avvio nel profilo. Nessun `credentials.json`, `token.json`, `.env`, backup, chiave privata o cartella `.git` presente nello ZIP.

Problemi concreti: Node/npm globali richiesti; installazione dipendenze al primo avvio; versione duplicata; porta fissa; launcher che termina server precedenti e relativo processo PowerShell; controlli Host per prefisso; callback local-auth su interfacce non limitate con assenza di state/PKCE/timeout; possibili mutazioni concorrenti; stato JSON corrotto sostituito in memoria dai default; token fittizi letterali nei test; riferimento aziendale in un placeholder.

Il pacchetto non contiene una cronologia Git analizzabile. Non è stata verificata la titolarità del codice o la liceità della distribuzione: la licenza resta da scegliere.

## File applicativi e dati utente

La build include `app/` con sorgenti necessari e dipendenze di produzione, `runtime/node.exe`, licenza Node, launcher grafico e istruzioni. Runtime scaricato durante la build, non committato. Le licenze dei pacchetti restano nei rispettivi moduli.

Il profilo resta allo stesso percorso e mantiene schema `version: 3`. Le directory di backup e i manifest AI non vengono migrati o rinominati. L'installer non scrive nel profilo. Il launcher usa il runtime privato; il fallback al Node globale è disponibile solo nel pacchetto sorgente senza sottocartella `app`.

Il numero della versione applicativa viene da `package.json`; il lock npm conserva la copia gestita automaticamente da npm. La versione runtime è un dato separato in `scripts/runtime.json`. Changelog e report possono contenere versioni storiche.

## Singola istanza e chiusura

Il launcher mantiene un mutex Windows per tutta la vita del processo Node. Inno lo verifica prima di installare/disinstallare. Il server mantiene inoltre un lock per profilo e pubblica `instance.json` con PID, identificativo casuale e porta. Una seconda istanza verifica l'identità del server e apre la stessa interfaccia; non scrive lo stato.

Se la porta 47831 appartiene a un altro servizio, il sistema assegna una porta libera. Una vecchia istanza GWB priva del nuovo protocollo va chiusa dal suo pulsante; non viene uccisa automaticamente. I lock abbandonati con PID non esistente possono essere recuperati; record corrotti o PID ambigui bloccano l'avvio conservativamente.

`GWB_DATA_DIR`, `GWB_PORT` e `GWB_NO_BROWSER=1` sono variabili per prove/sviluppo. Non sono necessarie all'uso normale e non sono un sistema per condividere il profilo tra più utenti.

## OAuth

Scopes di sola lettura al primo consenso. Per scrivere si usa un nuovo consenso Desktop con gli scope necessari e controllo che l'account sia lo stesso. Il token precedente viene sostituito soltanto dopo il controllo dell'account e la disponibilità di un refresh token. Non si usano token paralleli o un account di servizio.

Google non supporta autorizzazione incrementale per app installate: il nuovo consenso esplicito è intenzionale. Le autorizzazioni pregresse vanno revocate dal lato Google se si vuole ridurre con certezza l'accesso già concesso. Il callback locale non registra codici o token.

## Riproducibilità

Sorgenti e dipendenze applicative sono fissati dal lockfile; runtime Windows fissato da versione e SHA-256. Inno è fissato nel workflow. Il manifesto build elenca gli hash di tutti i file installabili e l'installer rifiuta file extra/modificati.

È una procedura ripetibile, non una promessa di installer identici byte per byte: compiler, runner, timestamp PE, toolchain e firma possono influenzare i byte. Lo ZIP sorgente usa ordine e timestamp fissi. Nelle release future verificare le versioni di Node, npm, Inno e delle Actions.
