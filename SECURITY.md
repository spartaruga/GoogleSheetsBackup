# Sicurezza

## Prima di condividere

Non caricare su GitHub o in una chat: JSON OAuth, token, refresh token, `.env`, chiavi/certificati privati, profilo `%APPDATA%\GoogleWorkspaceBackup`, backup originali, report o log non controllati. Il repository deve contenere solo sorgenti e documentazione.

`.gitignore` protegge dai normali inserimenti accidentali. Non rimuove file già tracciati o presenti nella cronologia, e `git add -f` lo può aggirare. `npm run check:repo` controlla anche i file tracciati e blocca i candidati senza stamparne il valore. La build distribuisce solo percorsi scelti esplicitamente. Nessun sistema può garantire che un proprietario non pubblichi manualmente un segreto.

## Quale dato è quale

| Dato | Significato e rischio |
| --- | --- |
| Credenziali OAuth Desktop | Identificano il client Cloud. Il client secret delle app installate non è un segreto confidenziale equivalente a quello di un server, ma il JSON va comunque distribuito separatamente e con controllo. Non concede da solo accesso ai documenti. |
| Access token | Credenziale temporanea che autorizza API Google. Non condividere. |
| Refresh token | Permette di ottenere nuovi access token. È un segreto persistente: non condividere. |
| Script ID | Identifica un progetto Apps Script; non è una password. Può rivelare riferimenti interni. |
| Spreadsheet ID | Identifica un Foglio; non scavalca i permessi, ma può rivelare riferimenti a documenti. |
| state.json | Progetti, ID, nomi, percorsi, account, storico e protezioni. Dato personale/organizzativo. |
| Backup originale | Può contenere codice, token applicativi, dati personali, note e commenti. Privato. |

Su Windows `token.json` usa DPAPI CurrentUser. Un vecchio token in chiaro viene migrato quando viene letto per autenticare una chiamata. La semplice indicazione dello stato del token non lo migra. Credentials e stato restano file nel profilo. DPAPI non protegge da codice malevolo già eseguito come lo stesso utente Windows.

## Controlla lo ZIP per l'AI

1. Scegli il file con suffisso `_PER_AI`, non la cartella originale.
2. Aprilo ed esamina `ai-package-manifest.json`: inclusioni, esclusioni, file protetti e censura.
3. Verifica che `apps-script/_content-api.json` non sia presente.
4. Cerca nei file inclusi nomi, email, ID, password, token, dati del Foglio, note e commenti che non vuoi condividere.
5. I metadati di progetto, titoli e ID possono restare anche escludendo i dati del Foglio. Se non vanno condivisi, non inviare l'archivio senza una revisione dedicata.
6. Verifica i segnaposto `[CENSURATO:...]`. Un file “Intoccabile” può essere incluso; solo “Escludi” lo rimuove.
7. Se hai dubbi, ripeti l'esportazione escludendo i contenuti interessati.

Il rilevatore esamina i sorgenti Apps Script. Le celle, note e commenti non hanno una classificazione automatica affidabile. Il controllo di hash blocca gli script cambiati dopo la preview; non elimina tutti i rischi dei dati inclusi.

## Server e login locali

Server UI e callback OAuth ascoltano solo su `127.0.0.1`. Le API verificano Host esatto, Origin quando presente, richieste browser cross-site e intestazione dedicata per le modifiche. Non concedono CORS a siti esterni. L'interfaccia ha CSP e blocco iframe.

OAuth usa state casuale, PKCE S256, consenso esplicito e scadenza di due minuti. Il tentativo può essere annullato dall'interfaccia; il callback viene chiuso e gli eventuali file token temporanei vengono rimossi. Token e codici di login non sono stampati nei log. Il server non viene esposto in rete locale. Programmi eseguiti sullo stesso PC con gli stessi diritti possono comunque chiamare il servizio: non è una barriera contro malware locale.

Chiusura e mutazioni simultanee vengono bloccate durante lavori in corso. Nessuna funzione dell'installer/launcher termina forzatamente processi Node sconosciuti. Arresti forzati di Windows/processi o guasti del disco restano fuori da queste garanzie.

La pubblicazione controlla lo stato Google prima della scrittura e verifica il risultato. L'API updateContent aggiorna l'intero progetto: resta una finestra di concorrenza con modifiche esterne tra lettura e scrittura. Evita modifiche contemporanee nel browser durante la pubblicazione. Mantieni il backup di sicurezza.

## Repository pubblico

- Scansione del pacchetto originale: non sono stati trovati file OAuth reali; i token letterali erano campioni di test.
- Campioni sensibili costruiti dinamicamente: i test continuano a riconoscerli.
- Lock npm con versioni/integrity; runtime Windows con versione e SHA-256 fissati.
- Dipendenze, runtime, ZIP, release, profili e chiavi esclusi dal Git.
- Conservate le licenze originali di Node e dipendenze nella build.
- Esegui `npm audit --omit=dev` prima delle release: i risultati cambiano nel tempo.

L'archivio fornito non include una directory `.git`: nessuna cronologia preesistente era disponibile da analizzare. Prima di copiare il progetto in un repository esistente, controlla anche tutti i commit/ref con uno scanner della cronologia. Se un segreto è già stato pubblicato, revocalo/ruotalo: cancellare il file corrente non basta.

## Segnalazioni

Nel repository, il proprietario deve abilitare **Settings → Code security → Private vulnerability reporting**, dove disponibile. Segnala poi dalla scheda **Security → Report a vulnerability**. Se non è disponibile, usa un contatto privato verificato del proprietario; non aprire issue pubbliche con token, backup o dati personali. Non è stato inventato un indirizzo email di assistenza.

Invia versione, passaggi riproducibili, impatto e un esempio fittizio. Oscura log, percorsi e identificativi non necessari.

Fonti: [OAuth per app installate](https://developers.google.com/identity/protocols/oauth2/native-app), [lettura Apps Script](https://developers.google.com/apps-script/api/reference/rest/v1/projects/getContent), [aggiornamento Apps Script](https://developers.google.com/apps-script/api/reference/rest/v1/projects/updateContent).
