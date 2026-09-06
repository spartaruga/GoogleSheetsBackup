# Google Workspace Backup 3.3.1 — Report finale

Consegna: progetto sorgente completo aggiornato, sorgenti del launcher/installer, build Windows e documentazione. **L'EXE non è stato compilato in questo ambiente Linux.** Il workflow Windows deve ancora essere eseguito; anche il login e un backup Google reale restano da collaudare.

## 1. Problemi trovati

- Avvio legato a Node/npm globali e installazione dipendenze al primo utilizzo.
- Porta fissa e chiusura forzata della precedente istanza.
- Versione duplicata in più file.
- Callback OAuth della libreria precedente non limitato al loopback, senza state, PKCE o scadenza.
- Mutazioni simultanee e chiusura durante operazioni potenzialmente interferenti.
- Configurazione corrotta sostituita silenziosamente dai default in memoria.
- Percorsi AI con caratteri speciali Windows non completamente bloccati.
- Possibilità che script cambiassero dopo la preview privacy.
- Token fittizi letterali e un placeholder aziendale nel sorgente.
- Mancanza di installer, pipeline di build e documentazione per il repository.

## 2. Modifiche effettuate

Mantenuti motore Node, server e interfaccia HTML/JS/CSS. Aggiunti installer Inno per utente, launcher grafico piccolo e runtime Node privato scaricato/verificato in build. I dati restano nel profilo originale.

Corretti i problemi di avvio, concorrenza e privacy. Il primo consenso richiede sola lettura. Il pulsante Abilita pubblicazione avvia un nuovo consenso esplicito con controllo dell'account, usando le protezioni previste per [OAuth Desktop](https://developers.google.com/identity/protocols/oauth2/native-app).

Versione centralizzata in package.json; lock npm aggiornato. Nessun Electron, framework UI, database o servizio cloud aggiuntivo. Nessun dato reale Google utilizzato durante il lavoro.

## 3. File modificati

Percorsi relativi alla cartella `GoogleWorkspaceBackup/` dello ZIP. Elenco completo rispetto al pacchetto originale:

| Percorso | Stato |
| --- | --- |
| `.github/workflows/windows-build.yml` | Aggiunto |
| `.gitignore` | Modificato |
| `CHANGELOG.md` | Aggiunto |
| `Diagnostica.bat` | Modificato |
| `LEGGIMI.txt` | Modificato |
| `LICENSE-TODO.md` | Aggiunto |
| `NOTE_VERSIONE.txt` | Modificato |
| `README.md` | Aggiunto |
| `SECURITY.md` | Aggiunto |
| `VERSION.txt` | Eliminato |
| `browser.mjs` | Aggiunto |
| `docs/ARCHITECTURE.md` | Aggiunto |
| `docs/CHROME_EXTENSION_PLAN.md` | Aggiunto |
| `docs/REPORT_FINALE.md` | Aggiunto |
| `docs/TEST_REPORT.md` | Aggiunto |
| `docs/UPDATE_PLAN.md` | Aggiunto |
| `engine.mjs` | Modificato |
| `installer/GoogleWorkspaceBackup.iss` | Aggiunto |
| `installer/Launcher.cs` | Aggiunto |
| `instance.mjs` | Aggiunto |
| `launcher.ps1` | Modificato |
| `oauth.mjs` | Aggiunto |
| `package-lock.json` | Modificato |
| `package.json` | Modificato |
| `public/app.js` | Modificato |
| `public/index.html` | Modificato |
| `scripts/build.mjs` | Aggiunto |
| `scripts/check-repo.mjs` | Aggiunto |
| `scripts/common.mjs` | Aggiunto |
| `scripts/installer.mjs` | Aggiunto |
| `scripts/runtime.json` | Aggiunto |
| `scripts/source.mjs` | Aggiunto |
| `server.mjs` | Modificato |
| `tests/engine.test.mjs` | Aggiunto |
| `tests/helpers.mjs` | Aggiunto |
| `tests/oauth.test.mjs` | Aggiunto |
| `tests/repo.test.mjs` | Aggiunto |
| `tests/server.test.mjs` | Aggiunto |
| `tests/windows-smoke.ps1` | Aggiunto |

`Avvia.vbs`, `Avvia_visibile.bat` e `public/style.css` sono conservati invariati. `VERSION.txt` è eliminato: la versione applicativa viene letta da package.json. Il lock npm ne mantiene la copia gestita da npm. I dati temporanei generati dai test e node_modules non sono nel sorgente consegnato.

## 4. Sicurezza GitHub

Nel pacchetto non sono stati trovati JSON OAuth reali, token personali, chiavi private, backup o percorsi personali. I candidati letterali erano campioni fittizi di test: ora vengono costruiti dinamicamente senza indebolire i controlli di rilevamento e preview.

.gitignore esteso; controllo sorgenti anche sui file tracciati; build da elenco esplicito; runtime e dipendenze fuori Git; checksum del runtime fissato; manifest e controllo dei file in dist prima dell'installer. Licenze delle dipendenze preservate.

Audit npm: zero vulnerabilità segnalate al controllo. Nessuna cronologia Git era presente nell'allegato: un eventuale repository precedente va controllato separatamente. La scansione non garantisce l'assenza assoluta di segreti e non impedisce caricamenti manuali forzati.

La licenza non è stata scelta al posto del proprietario. Leggi `LICENSE-TODO.md` prima della pubblicazione definitiva.

## 5. Installer

Sorgenti: `installer/GoogleWorkspaceBackup.iss` e `installer/Launcher.cs`.

La build prevista produce `release/GoogleWorkspaceBackup-Setup-3.3.1.exe` e il relativo `.sha256`. Il Setup include `app/`, runtime privato, launcher e istruzioni. Installazione in LOCALAPPDATA/Programs, Start menu e Desktop opzionale, disinstallazione Windows, senza PATH o elevazione amministrativa ordinaria. Profilo e backup vengono mantenuti.

La [direttiva Inno PrivilegesRequired](https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm) è impostata a `lowest`. Un mutex blocca installazione/disinstallazione mentre il launcher è in esecuzione. Nessun processo viene terminato forzatamente dal launcher.

**Non è presente un Setup già compilato:** mancano Windows, PowerShell e Inno nell'ambiente usato. La compilazione e lo smoke test sono predisposti nel workflow GitHub; il loro esito non è ancora noto. Non c'è firma Authenticode.

## 6. Come testare

Per provare il sorgente su un PC di sviluppo Windows con Node.js 24 LTS:

1. Estrai lo ZIP e apri PowerShell nella cartella contenente package.json.
2. Esegui `npm ci --ignore-scripts`.
3. Esegui `npm run self-test`, poi `npm test`.
4. Esegui `npm start`.
5. Configura Google con un account e documenti di prova seguendo README.md.
6. Fai un backup con formule, colori, note, commenti e Apps Script; controlla JSON/Excel/ZIP.
7. Prova import AI e protezioni prima su una copia locale. Pubblica solo nel progetto di prova.

Per ottenere il Setup:

1. Su Windows installa Inno Setup nella versione indicata in scripts/runtime.json.
2. Esegui `npm run check:repo`.
3. Esegui `npm run build`.
4. Esegui `npm run installer`.
5. Prova il Setup in una VM senza Node globale, poi verifica riapertura, aggiornamento e disinstallazione.

**Eseguiti qui:** self-test e 11 test automatici, tutti superati; installazione da lock, audit e controllo sorgenti. Copertura dettagliata in docs/TEST_REPORT.md. API Google simulate. Windows e Google reale non collaudati. La prova di reinstallazione del workflow non sostituisce l'upgrade reale dal pacchetto 3.3.0.

## 7. Come pubblicare su GitHub

1. Scegli la licenza e leggi SECURITY.md.
2. Crea un repository vuoto e carica soltanto il sorgente di questo ZIP.
3. Esegui i controlli del README e rivedi `git status` prima del commit.
4. Attiva Secret Scanning/push protection dove disponibili e segnalazioni private.
5. Apri **Actions → Windows build → Run workflow**.
6. Se test e build passano, scarica l'artefatto **GoogleWorkspaceBackup-release**.
7. Prova il Setup su Windows e con Google di prova.
8. Crea una Release in bozza con tag **v3.3.1**, allegando Setup, SHA-256 e ZIP sorgente; aggiungi il changelog.
9. Pubblica la Release solo dopo il collaudo. Nessun repository o release è stato pubblicato durante questo lavoro.

README.md contiene i comandi completi. Il workflow carica gli artefatti ma non pubblica automaticamente Release. [Guida GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## 8. Prossimi upgrade

1. Collaudo Windows/Google reale e prima Release verificata.
2. Firma del programma e dell'installer, dopo la scelta del canale ufficiale.
3. Pulsante di controllo aggiornamenti, senza installazione silenziosa iniziale.
4. Estensione Chrome con associazione iniziale Foglio/Script verificata e delega al desktop tramite Native Messaging.

I piani sono in docs/UPDATE_PLAN.md e docs/CHROME_EXTENSION_PLAN.md. L'estensione non presume di ricavare automaticamente ogni Script ID dal solo Spreadsheet ID.
