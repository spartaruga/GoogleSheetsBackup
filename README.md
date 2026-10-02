# Google Workspace Backup

Programma Windows per salvare Fogli Google e progetti Apps Script sul proprio PC. Interfaccia nel browser, server locale, nessun servizio cloud aggiuntivo. La versione dell'applicazione è definita in `package.json` e mostrata nell'interfaccia.

## Installazione per chi deve usare il programma

1. Apri la [Release più recente](https://github.com/spartaruga/GoogleSheetsBackup/releases/latest) e scarica **solo `GoogleWorkspaceBackup-Setup-X.Y.Z.exe`**. Il file `.sha256` serve se vuoi verificare il download.
2. Avvia l'installer e premi **Avanti → Installa**. Il collegamento Desktop è facoltativo.
3. Apri **Google Workspace Backup** dal menu Start.
4. Completa la configurazione Google qui sotto.

L'installer include Node.js privato e tutte le dipendenze. Il PC dell'utilizzatore non deve avere Node.js o npm. Non modifica PATH e non richiede normalmente privilegi amministrativi. Target: Windows 10/11 x64. Windows ARM e altri sistemi non sono target collaudati di questa distribuzione.

**Questo ZIP è il progetto sorgente**, non un installer compilato: per ottenere il Setup usa la procedura GitHub Actions o la build Windows descritta sotto. Non rinominare lo ZIP in `.exe`.

Il Setup non è firmato digitalmente in questa versione. Windows può mostrare “Autore sconosciuto”. Verifica provenienza e checksum; non disattivare le protezioni del PC per eseguire un file dubbio.

## Configura Google, una volta per account/PC

1. Apri [Google Cloud](https://console.cloud.google.com/) e crea o seleziona un progetto.
2. In **API e servizi → Libreria** abilita **Google Drive API**, **Google Sheets API**, **Apps Script API**, tutte nello stesso progetto.
3. In **Google Auth Platform** configura **Branding** e **Audience**.
4. Per utenti della stessa organizzazione Workspace, usa **Internal** se disponibile. Per account esterni usa **External** e, durante i test, aggiungi gli utenti nella lista dei test user.
5. In **Clients → Create client**, scegli **Desktop app**. Scarica il JSON.
6. Nel programma, in **Configurazione**, premi **Seleziona JSON** e scegli quel file.
7. Apri le [impostazioni Apps Script](https://script.google.com/home/usersettings) e attiva **API Google Apps Script** per il tuo account.
8. Premi **Collega account**. Nel browser scegli l'account che ha accesso ai Fogli e agli script e accetta i permessi. Se il browser non si apre, usa **Apri l'accesso Google** mostrato sotto ai pulsanti. Durante il tentativo puoi usare **Annulla e scollega** e ricominciare subito.
9. Premi **Verifica accesso** dopo aver aggiunto i progetti. Leggi gli eventuali errori accanto a ciascun progetto.

Il JSON OAuth va distribuito separatamente dal programma alle sole persone autorizzate. Ogni persona deve collegare il proprio account. Non condividere token personali. La disponibilità degli accessi dipende anche dalle regole dell'amministratore Workspace.

Fonti: [creazione credenziali Google](https://developers.google.com/workspace/guides/create-credentials), [abilitazione Apps Script API](https://developers.google.com/apps-script/api/how-tos/enable).

## Permessi richiesti

| Azione | Scope Google |
| --- | --- |
| Leggere/esportare Drive e commenti | `https://www.googleapis.com/auth/drive.readonly` |
| Leggere dati, formule, note e formati Sheets | `https://www.googleapis.com/auth/spreadsheets.readonly` |
| Primo login: leggere Apps Script | `https://www.googleapis.com/auth/script.projects.readonly` |
| Solo dopo “Abilita pubblicazione”: aggiornare Apps Script | `https://www.googleapis.com/auth/script.projects` |
| Solo dopo “Abilita diagnostica”: esecuzioni | `https://www.googleapis.com/auth/script.processes` |
| Diagnostica: log Cloud disponibili all’account | `https://www.googleapis.com/auth/logging.read` |
| Diagnostica: inventario deployment | `https://www.googleapis.com/auth/script.deployments.readonly` |

Il programma non richiede lo scope di scrittura di Sheets. Il codice Apps Script che scegli di pubblicare può però modificare dati quando viene eseguito da Google: controllalo prima.

Per pubblicare, vai in **Modifiche AI → Abilita pubblicazione**. Compare un nuovo consenso per lettura Drive/Sheets e scrittura Apps Script. Scegli lo stesso account già collegato: se cambia, il programma conserva il vecchio token e blocca il cambio. Questo pulsante autorizza; non pubblica.

Le app Desktop non supportano l'autorizzazione incrementale come le app web: questa versione usa un nuovo consenso esplicito, senza un secondo archivio di token. I vecchi token con scrittura continuano a funzionare. Scollegare localmente non revoca i permessi Google. Per tornare con certezza alla sola lettura, revoca l'accesso nelle [connessioni dell'account Google](https://myaccount.google.com/connections), poi ricollega dal programma. [Documentazione OAuth Desktop](https://developers.google.com/identity/protocols/oauth2/native-app).

## Fai un backup

1. In **Progetti** premi **Aggiungi progetto**.
2. Inserisci un nome e il link del Foglio.
3. Per includere il codice: nel Foglio apri **Estensioni → Apps Script → Impostazioni progetto → ID script**, quindi incollalo nel programma. Puoi anche salvare solo uno script.
4. Premi **Salva e continua**.
5. Scegli la destinazione. Lascia attivi Excel e ZIP se ti servono.
6. Premi **Scansiona e avvia backup**.
7. Controlla l'anteprima privacy, poi premi **Conferma e crea backup**.
8. Aspetta il risultato. Le versioni precedenti restano sul disco.

Per fermarti usa **Annulla backup**. La richiesta viene eseguita al punto sicuro successivo: una chiamata Google già in corso può richiedere tempo. Per uscire usa **Chiudi programma**; chiudere solo la scheda browser lascia il server attivo. Durante un'operazione la chiusura e le altre modifiche vengono bloccate.

## Cosa viene salvato

| File/cartella | Contenuto |
| --- | --- |
| `spreadsheet.full.json` | Risposta Sheets con dati, formule native e formati disponibili tramite API |
| `spreadsheet.xlsx` | Copia Excel di consultazione, se l'esportazione Google riesce |
| `formulas.json` | Formule originali, scheda e cella, comprese ARRAYFORMULA |
| `notes.json` | Note delle celle |
| `comments.json` | Commenti e risposte accessibili tramite Drive API |
| `structure.json` | Schede, intervalli, filtri, grafici e altre strutture API |
| `apps-script/` | Sorgenti `.gs`, `.html`, manifest e risposte API originali |
| `backup-info.json` | Esito, avvisi e riferimenti del progetto |
| `*_PER_AI.zip` | Copia da condividere dopo il controllo privacy |

Il JSON nativo è il riferimento per le formule Google; Excel può convertirle o rappresentarle diversamente. Commenti e copia Excel possono fallire separatamente: il programma salva un avviso. Non considerare il backup completo senza controllare questi avvisi.

**Non vengono salvati automaticamente:** cronologia revisioni completa, file collegati tramite URL, allegati Drive, proprietà Script/User/Document Properties, inventario live dei trigger installabili, deployment/versioni Apps Script precedenti, impostazioni Google Cloud e autorizzazioni necessarie a ricostruire tutto. Non è un ripristino completo con un clic. Vengono salvati i contenuti che le API e l'account rendono disponibili, non una clonazione integrale di Google Workspace.

### Esecuzioni e trigger nello stesso ZIP

Nella pagina **Backup** scegli **Includi esecuzioni Apps Script nello ZIP** e/o **Includi inventario trigger salvato nello ZIP**, più il periodo 1/7/30 giorni. Le scelte restano memorizzate e usano i progetti e gli ID già salvati. I file selezionati vengono aggiunti alla cartella `diagnostics/` nello stesso ZIP per l’AI; con entrambe le caselle spente il backup mantiene il contenuto precedente.

L’accesso Google, gli ID e la destinazione restano nel profilo durante l’aggiornamento: chiudi il programma e installa il nuovo Setup. Non serve riconfigurare i progetti. I permessi per leggere le esecuzioni si abilitano una volta con **Abilita diagnostica**.

Per i dettagli Cloud, configura il progetto una volta in **Trigger ed esecuzioni → Salva impostazioni del progetto**. La raccolta manuale salva anche queste impostazioni. Ogni progetto conserva il proprio ID Cloud e la propria chiave script. I token riconoscibili nei file diagnostici vengono censurati nella copia ZIP per l’AI; controlla comunque i log prima di condividere dati personali.

Per i trigger, esegui `gwbExportTriggers` nell’editor Apps Script e usa **Salva inventario** una volta. Il programma riutilizza quel JSON nei successivi ZIP, con la data originale e `live: false`; se modifichi i trigger, salva un inventario aggiornato. Un inventario assente o un errore di autorizzazione delle esecuzioni produce un avviso nello ZIP, senza eliminare il normale backup. Cambiare lo Script ID del progetto azzera le impostazioni diagnostiche e l’inventario associati al vecchio script.

## Trigger ed esecuzioni

1. Apri **Trigger ed esecuzioni**, scegli un progetto con Script ID e premi **Abilita diagnostica**. Il nuovo consenso mantiene i permessi di pubblicazione già concessi.
2. Scegli 1, 7 o 30 giorni e premi **Raccogli esecuzioni**.
3. Scarica lo ZIP: contiene `esecuzioni.json`, `esecuzioni.csv` e un riepilogo. Una copia resta nella destinazione dei backup.

La tabella mostra errori, timeout, durate e avvii automatici fuori 20:00–08:30 italiane. Il controllo frequente delle formule può essere un’eccezione intenzionale. Lo storico API non contiene il testo dell’errore: per quello seleziona **Includi log Cloud**, inserisci l’ID del progetto Cloud **dello script** e abilita Cloud Logging API. Serve un progetto Cloud standard e accesso ai suoi log. Se `script.googleapis.com/project_key` nei log è diverso dallo Script ID, inserisci quella chiave nell’apposito campo. Log mancanti o parziali vengono segnalati; non significano assenza di errori. Versioni e deployment disponibili vengono inclusi nel JSON.

**Piano trigger:** premi **Leggi funzioni**, aggiungi le regole e prepara l’anteprima. Puoi scaricare `GWB_Triggers.gs` oppure pubblicarlo con il permesso Apps Script già usato per le Modifiche AI. Il programma salva prima una copia integrale dei sorgenti correnti e blocca conflitti e file intoccabili. Poi apri l’editor Google ed esegui **`gwbApplyTriggerPlan`**, autorizzando il servizio trigger se richiesto.

Le regole sostituiscono/rimuovono solo i trigger CLOCK degli handler elencati e dell’account che esegue la funzione. Gli altri trigger restano presenti. Il piano viene applicato una regola alla volta: se una regola fallisce, quelle precedenti possono essere già applicate. Rilancia **lo stesso piano** per completarlo. Se la quota è già piena, Google può impedire anche una singola sostituzione: rimuovi una regola non necessaria prima di crearne una nuova. Gli orari sono approssimativi, ±15 minuti.

Per verificare il risultato esegui **`gwbExportTriggers`** nell’editor e salva il JSON nel riquadro inventario. Rimane memorizzato per il progetto, anche dopo il riavvio. Google non espone il calendario dei trigger creati da altri installer: il programma mostra l’orario solo per i trigger creati con questo gestore. Il preset notturno richiede le funzioni `gestionale_night…` già pubblicate; non elimina automaticamente i vecchi handler diversi.

La pubblicazione del piano **non cambia i trigger** finché non esegui la funzione nell’editor. Le API Google non possono crearli. Fonti: [limiti dell’API](https://developers.google.com/apps-script/api/how-tos/execute#limitations), [storico processi](https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses), [Cloud Logging](https://developers.google.com/apps-script/guides/logging).

## Privacy e uso con un'AI

- Token riconoscibili: selezione iniziale **Censura**.
- Segnalazioni incerte: **Includi**, con avviso e preview che nasconde i valori rilevati.
- **Escludi**: il file non entra nello ZIP e diventa intoccabile.
- **Intoccabile** da solo protegge dalle modifiche; non significa automaticamente escluso dallo ZIP.
- Dati del Foglio: puoi escluderli insieme a formule, note, commenti e struttura.

La cartella originale sul PC conserva il contenuto integrale. Non condividerla per errore. Lo ZIP può ancora contenere nomi, identificativi, metadati del progetto e qualsiasi dato che hai scelto di includere. Non è anonimo. La scansione non riconosce ogni segreto. Se uno script cambia tra preview e backup, l'esportazione si ferma e chiede di ripetere la scansione.

1. Condividi solo lo ZIP `_PER_AI` controllato.
2. Chiedi all'AI di seguire `ISTRUZIONI_PER_AI.md` e restituire `modifiche-ai.json`.
3. Importalo in **Modifiche AI** e leggi l'anteprima.
4. Prova prima **Crea solo copia locale**.
5. Se vuoi scrivere su Google, autorizza la pubblicazione e usa **Pubblica su Google** nello storico.

Prima della scrittura viene creata una copia di sicurezza dello stato Google corrente. Hash, file intoccabili e conflitti con modifiche esterne vengono verificati; il codice viene riletto dopo l'aggiornamento. Non si crea automaticamente un nuovo deployment web app. I formati backup e pacchetto AI restano quelli precedenti; l'import controllato richiede il manifesto locale introdotto nelle versioni precedenti.

## Dove sono i dati

| Contenuto | Percorso Windows |
| --- | --- |
| Programma installato | `%LOCALAPPDATA%\Programs\GoogleWorkspaceBackup` |
| JSON OAuth importato | `%APPDATA%\GoogleWorkspaceBackup\credentials.json` |
| Token personale | `%APPDATA%\GoogleWorkspaceBackup\token.json` |
| Progetti, storico, account, file intoccabili | `%APPDATA%\GoogleWorkspaceBackup\state.json` |
| Dati temporanei dell'istanza | `instance.json`, `instance.lock` nella stessa cartella |
| Log | `server.log`, `server.log.previous`, `server-error.log`, `startup-error.log` nella stessa cartella |
| Backup predefiniti | `Downloads\GoogleWorkspaceBackup`, oppure la destinazione scelta |

Su Windows il token è cifrato con DPAPI per l'utente corrente. Il JSON OAuth e lo stato non sono cifrati dall'app: protegge l'accesso il profilo Windows. Su altri sistemi il token resta in chiaro con permessi di file restrittivi; il prodotto distribuito è Windows. I log possono contenere nomi/percorso progetto ed errori API: non caricarli senza controllarli.

## Aggiornamento e disinstallazione

1. Premi **Controlla aggiornamenti** per aprire la Release ufficiale, poi aspetta il termine dei lavori e premi **Chiudi programma** anche nella vecchia versione.
2. Installa il nuovo Setup nella stessa cartella.
3. Riapri e verifica versione, account, progetti e storico.

Il Setup aggiorna i file applicativi e mantiene i dati nel profilo e i backup. Non copia automaticamente dati da cartelle non standard. Non usare la cartella d'installazione come destinazione backup.

Per disinstallare: **Impostazioni Windows → App → App installate → Google Workspace Backup → Disinstalla**. Il programma e i collegamenti vengono rimossi; profilo e backup restano. Per rimuovere anche i dati, prima salva ciò che ti serve, scollega/revoca Google e rimuovi manualmente le sole cartelle personali indicate sopra. L'app non le cancella durante la disinstallazione.

## Se qualcosa non funziona

- **Sorgente senza Node:** usa il Setup compilato, oppure segui la build qui sotto. L'installer non richiede Node globale.
- **Finestra non aperta:** avvia `Avvia_visibile.bat` o `Diagnostica.bat` e leggi i log nella cartella profilo.
- **Versione precedente attiva:** chiudila dal suo pulsante. Non terminare tutti i processi Node: potrebbero appartenere ad altri programmi.
- **Porta occupata:** il server prova la porta storica 47831 e, se occupata da altro, chiede al sistema una porta libera. Il launcher legge la porta effettiva. Non servono porte in ingresso sul router.
- **Blocco locale non leggibile dopo un arresto anomalo:** riavvia Windows. Solo dopo aver verificato che GWB non sia in esecuzione, rimuovi `instance.json`, `instance.lock` e l'eventuale `instance.lock.recovery` dal profilo. Non rimuovere `state.json` o token.
- **`state.json` non valido:** il programma si ferma senza sovrascriverlo. Conservane una copia e ripristina una versione valida.
- **Login scaduto/negato:** ripremi Collega account. Il callback si chiude dopo due minuti. Puoi interromperlo prima con **Annulla e scollega**.
- **Access blocked:** controlla test user, audience e regole Workspace. Un'app OAuth External in Testing può richiedere una nuova autorizzazione dopo la scadenza del refresh token; consulta le regole OAuth Google per il tuo caso.
- **API disabilitata:** abilitala nello stesso progetto Cloud del JSON importato.
- **Not found/Permission denied:** verifica l'account, gli ID e l'accesso ai documenti.
- **Scrittura non concessa:** usa Abilita pubblicazione e scegli lo stesso account.
- **Token DPAPI non decifrabile:** accedi con l'utente Windows originale oppure collega nuovamente Google sul nuovo PC.
- **Excel/commenti mancanti:** controlla gli avvisi. Il JSON Sheets e i sorgenti possono essere stati salvati correttamente.

## Build Windows, per il proprietario/sviluppatore

Sul PC che **crea** l'installer servono Node.js 24 LTS con npm, Windows PowerShell 5.1, compilatore .NET Framework 4.x di Windows e [Inno Setup](https://jrsoftware.org/isdl.php) 6.7.3. Questi strumenti non sono richiesti ai destinatari. Le versioni del runtime e di Inno sono in `scripts/runtime.json`.

Apri PowerShell nella cartella del progetto ed esegui, uno alla volta:

```powershell
npm ci --ignore-scripts
npm run self-test
npm test
npm run check:repo
npm run build
npm run installer
npm run source
```

Risultati:

- `dist/`: applicazione pronta con `app/`, `runtime/node.exe` e launcher grafico.
- `release/GoogleWorkspaceBackup-Setup-X.Y.Z.exe`: installer.
- File `.sha256` accanto all'installer.
- `release/GoogleWorkspaceBackup_vX.Y.Z_source.zip`: sorgente selezionato e controllato.

La build scarica il runtime ufficiale e verifica uno SHA-256 fissato nel progetto; usa `npm ci` e il lockfile. Il workflow scarica anche Inno Setup dalla Release ufficiale e ne verifica lo SHA-256, senza dipendere dal catalogo Chocolatey. Non importa `node_modules` dal PC di sviluppo. La directory `dist` viene ricreata: non usarla per dati personali. L'installer controlla che `dist` corrisponda al manifesto della build. Se Inno è in un'altra cartella, imposta `$env:ISCC_PATH` al percorso completo di `ISCC.exe`.

Per provare solo il sorgente: dopo `npm ci --ignore-scripts`, esegui `npm start` o `Avvia.vbs`. Solo in questa modalità il launcher può usare Node globale; non installa componenti al primo avvio.

**Senza preparare un PC di build:** il workflow **Windows build** compila e prova il Setup. Le PR producono solo un artefatto. Un push su `main` o un tag `vX.Y.Z` pubblica la Release dopo tutti i controlli. Da **Run workflow** puoi scegliere se pubblicare o produrre solo l’artefatto `GoogleWorkspaceBackup-release`.

## Pubblica su GitHub e crea una Release

1. Prima di rendere pubblico il progetto, leggi `SECURITY.md` e scegli la licenza indicata in `LICENSE-TODO.md`.
2. Crea un repository vuoto. Estrai lo ZIP sorgente in una cartella dedicata, senza profili o backup.
3. Esegui i comandi di controllo sopra. Inizializza Git solo in quella cartella:

```powershell
git init -b main
git add .
git status --short
npm run check:repo
git diff --cached --stat
git commit -m "Prepare Windows distribution"
```

4. Aggiungi come `origin` l'URL del tuo repository usando il comando mostrato da GitHub e fai `git push -u origin main`.
5. Abilita Secret Scanning/push protection dove disponibili e Private vulnerability reporting nelle impostazioni del repository.
6. Avvia **Actions → Windows build**. Leggi l'esito: non distribuire build con test falliti.
7. Scarica l'artefatto del workflow e prova il Setup su una VM Windows senza Node, usando un progetto Google di prova.
8. Incrementa la versione in `package.json` e lockfile, aggiungi le note in `CHANGELOG.md` e integra la modifica su `main`.
9. Il job Release crea il tag sul commit verificato, allega EXE/ZIP e checksum, controlla dimensioni e digest e pubblica la Release. Non sovrascrive una versione appartenente a un altro commit. Il login Google reale resta un controllo da fare con il tuo account e un progetto di prova.

In alternativa crea e invia un tag `vX.Y.Z`: il workflow verifica che corrisponda a `package.json`, compila, prova e pubblica. [Guida ufficiale GitHub alle Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

Per la prossima versione usa `npm version patch --no-git-tag-version`, aggiorna il changelog e ripeti i controlli. La versione eseguibile deriva da `package.json`; i riferimenti storici nella documentazione restano storici.

Verifica un download in PowerShell:

```powershell
Get-FileHash .\GoogleWorkspaceBackup-Setup-X.Y.Z.exe -Algorithm SHA256
```

Confronta il risultato con il file `.sha256`. Il checksum rileva alterazioni; non sostituisce la firma dell'autore.

## Stato dei collaudi

Leggi `docs/TEST_REPORT.md`: distingue test eseguiti localmente, test Windows predisposti e verifiche Google reali ancora da fare. Non ci sono credenziali reali nel progetto. Piano Chrome in `docs/CHROME_EXTENSION_PLAN.md`; aggiornamenti futuri in `docs/UPDATE_PLAN.md`.
