# Verifiche

## Versione 3.4.5 — 2026-10-03

- Modifica circoscritta al Setup: dialogo di chiusura e helper PowerShell incluso nell’installer. Nessuna modifica alle API Google, al backend o al formato dei dati personali.
- 43 test Node, self-test, controllo repository e `git diff --check` superati localmente. PowerShell, Inno Setup e finestra dell’installer vengono verificati sul runner Windows.
- L’helper non forza processi né cancella blocchi. Controlla PID e ID dell’istanza, bypassa il proxy per le chiamate loopback e usa `/api/shutdown`, che rifiuta operazioni in corso anche dopo il controllo iniziale.
- Il collaudo Windows esercita il pulsante della finestra reale del Setup sull’upgrade dalla Release 3.4.3 con l’app aperta. Una richiesta locale fittizia verifica che chiusura e installazione si fermino durante una scrittura. I casi con PID estraneo e blocco corrotto non autorizzano la chiusura; il controllo di un PID non più esistente conserva il blocco.
- Il [collaudo Windows 3.4.5](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/37111129525) ha superato 43 test Node, UI web, controlli sui PID, blocco durante una scrittura e pulsante del Setup reale. Ha premuto «Chiudi l’app e continua» sulla 3.4.3 aperta, completato l’upgrade alla 3.4.5 e la disinstallazione con credenziali, token, ID e backup conservati tramite confronto degli hash. Verificati anche runtime incluso e seconda istanza.
- Release 3.4.5 pubblicata con quattro asset e checksum; tag e commit verificati: `cb02ebc48ec15d27273857c6ebfda8b19afea237`.
- API Google simulate e profili fittizi. Il pulsante chiude l’app Windows; non interrompe esecuzioni Apps Script remote.
- La candidata 3.4.4 non è stata distribuita: il [primo collaudo](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/37110306580) ha superato compilazione, UI web, protezione delle scritture e dei PID, poi non ha trovato i controlli del Setup tramite UI Automation. Il test 3.4.5 usa i controlli Win32 del solo processo installer e gestisce il normale avvio dell’app dopo «Fine»; la pubblicazione resta subordinata al collaudo completo.

## Versione 3.4.3 — 2026-10-02

- 43 test Node, self-test, controllo repository, sintassi JavaScript e `git diff --check` superati localmente. Verificati struttura HTML, ID unici, assenza di riferimenti JS a campi rimossi e filtri/retention del workflow.
- Le modifiche riguardano UI e percorso di pubblicazione; backend, formato del profilo e raccolta del backup restano compatibili.
- Il test browser Windows controlla cinque sezioni, assenza della pagina e della raccolta diagnostica duplicate, impostazioni e inventario nel Backup, piano trigger, arrivo in Modifiche AI dopo successo o errori parziali e permanenza nel Backup dopo errore o annullamento. Risultati resta raggiungibile manualmente; il layout viene verificato anche a 390 px.
- Il collaudo installer ora scarica la Release 3.4.2 con SHA-256 fissato e verifica l’upgrade alla nuova versione, conservando profilo, credenziali, token e backup tramite confronto degli hash.
- La pipeline Windows si avvia soltanto per `package.json` su `main` o su richiesta manuale. PR e commit ordinari non compilano installer; gli artefatti temporanei hanno durata 3 giorni.
- L’unico [workflow della Release 3.4.3](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/37043798531) ha superato 43 test Node, test browser Windows, installazione, upgrade reale 3.4.2 → 3.4.3 e disinstallazione con i dati conservati. La Release pubblica contiene installer, sorgenti e relativi checksum; tag e commit verificati: `a810781396a928d9577e0d9fcd0c0b2e0a9d3be4`.
- API Google simulate e profili fittizi nei test. Nessun consenso Google reale è collaudato da queste verifiche.

## Versione 3.4.2 — 2026-10-02

- 43 test locali, self-test e controllo repository superati. Il nuovo caso verifica che una risposta di pubblicazione con un tag inatteso non venga dichiarata riuscita.
- Il tag viene trasmesso esplicitamente nella creazione, nella modifica della bozza e nella pubblicazione. Restano i controlli su commit e checksum e il divieto di sostituire release già pubblicate.
- La procedura 3.4.2 corregge una volta l’etichetta provvisoria della Release 3.4.1, soltanto dopo aver verificato ID, commit e digest dei quattro asset; non ne sostituisce i byte.
- I [42 test e il collaudo Windows della 3.4.1](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/37033480659) hanno superato UI, upgrade dalla 3.4.0 e conservazione dei dati. Il nuovo pacchetto ripete questi controlli prima della pubblicazione. Nessuna chiamata Google autenticata nei test.

## Versione 3.4.1 — 2026-10-02

- Self-test, 42 test Node, controllo repository e audit npm superati in Linux. Nessuna chiamata Google autenticata nei test.
- Verificati i quattro casi delle opzioni ZIP: nessun extra, sole esecuzioni, soli trigger, entrambi. Il contenuto viene letto da un lettore ZIP indipendente; i token fittizi nei log sono censurati solo nella copia AI.
- Verificata la conservazione di ID Cloud, chiave script, inventario e scelte ZIP dopo salvataggio dei progetti e riavvio; cambiare Script ID elimina i dati diagnostici del vecchio progetto.
- Verificati i casi di scope mancanti, inventario assente, configurazione Cloud incompleta e annullamento durante la paginazione. Il normale backup resta disponibile quando la diagnostica non è accessibile.
- La pipeline Windows ora prova le impostazioni nell’interfaccia e l’upgrade reale dalla Release pubblica 3.4.0. Usa un profilo e token fittizi su runner usa e getta, confrontando gli hash dei dati dopo installazione e disinstallazione. Questo non collauda il consenso Google reale.
- Il [collaudo Windows](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/37031878374) ha superato i 40 test del backup, la prova UI e l’upgrade reale 3.4.0 → 3.4.1. La pubblicazione iniziale si è fermata perché la bozza appena creata non era subito nell’elenco; due test aggiuntivi verificano la creazione usando direttamente l’ID restituito e la sostituzione degli asset incompleti della bozza, mantenendo il controllo dei checksum e dei conflitti con versioni pubblicate.

## Versione 3.4.0 — 2026-10-01

- Node v24.19.0 Linux: self-test, 36 test, controllo repository e audit npm superati.
- I nuovi test verificano permessi opzionali e mantenimento dello scope scrittura, paginazione, esportazione ZIP/CSV, errori di autorizzazione e log mancanti, confini Europe/Rome, piani trigger riprendibili, conservazione degli altri trigger e protezioni dei sorgenti.
- La [pipeline Windows](https://github.com/spartaruga/GoogleSheetsBackup/actions/runs/36890341067) ha compilato il Setup e superato installazione, avvio senza Node globale, interfaccia in browser con API simulate, reinstallazione e conservazione dei dati, disinstallazione. I test di pubblicazione aggiunti in seguito verificano la ripresa delle bozze, i conflitti di tag e il controllo degli asset.
- Nessuna chiamata autenticata a Google reale, nessuna modifica dei trigger dell’utente e nessun token reale usato nei test. Il consenso, la raccolta reale e l’applicazione dei trigger vanno verificati con un progetto di prova.
- La Release automatica verifica gli asset e li pubblica dopo la riuscita del job Windows. Non dichiara collaudato il login Google reale.

## Archivio: versione 3.3.1

## Eseguite in questo ambiente

Ambiente Linux, Node.js v24.19.0. Nessuna credenziale o chiamata autenticata a Google reale. Runtime previsto nel Setup Windows: v24.20.0, versione e SHA-256 acquisiti dalla distribuzione ufficiale.

- Installazione npm dal lockfile riuscita.
- Self-test originale mantenuto e superato.
- `npm test`: **11 test superati, 0 falliti**.
- `npm run check:repo`: nessun candidato rilevato nei sorgenti consegnati.
- `npm audit --omit=dev`: nessuna vulnerabilità segnalata alla data della verifica, 6 settembre 2026. Non è una garanzia futura.
- Controlli sintattici dei file JavaScript/ESM.
- Ricontrollo del contenuto dello ZIP sorgente rispetto all'elenco previsto e SHA-256 generato.

## Cosa coprono gli 11 test

| Test | Verifica |
| --- | --- |
| Self-test, scope e percorsi AI | Test precedenti, scopes readonly, blocco nomi riservati e alternate data stream, segnaposto duplicati/rimossi |
| Backup/pubblicazione con API simulate | Snapshot completo, ARRAYFORMULA, formati, note, commenti paginati/risposte, export, ZIP, censura, protezioni, verifica scrittura, ripetizione idempotente e conflitto live |
| Privacy ZIP | Script cambiato dopo la scansione bloccato; note escluse assenti dallo ZIP |
| Foglio grande | Lettura per blocchi, titolo con apostrofo, offset dei blocchi, metadati conservati |
| Annullamento | Rimozione dei file/cartelle parziali |
| OAuth | Callback 127.0.0.1, state errato rifiutato, PKCE verificato prima dello scambio simulato |
| OAuth abbandonato | Timeout e porta callback liberata |
| Controllo repository | File privati e token fittizi riconosciuti, valori mai stampati |
| Server locale | Collisione porta, Host/Origin/cross-site, richieste sovrapposte, chiusura bloccata, seconda istanza e profilo conservato al riavvio |
| Import AI HTTP | Preview, hash, applicazione su copia, intoccabili saltati, baseline intatta, conflitto bloccato |
| Stato corrotto | Avvio fallisce senza sovrascrivere il file |

Gli XLSX usati dal test sono byte fittizi restituiti dal mock API: il test prova il salvataggio del risultato, non la fedeltà di una conversione Excel di Google. I formati JSON sono confrontati con fixture. Gli scope sono verificati nel codice e le risposte Google sono simulate: non è un login reale.

## Predisposte, NON eseguite qui

Il workflow `.github/workflows/windows-build.yml` esegue test e build su Windows 2022, compila launcher C# e Setup Inno, quindi avvia `tests/windows-smoke.ps1` su runner usa e getta:

1. Installazione pulita in un percorso con spazi.
2. Avvio del launcher con PATH del figlio privo di Node/npm globali.
3. Verifica che non esistano account/progetti preconfigurati.
4. Secondo avvio: stesso PID server.
5. Chiusura pulita.
6. Inserimento di un profilo **fittizio** compatibile con schema v3 e token DPAPI fittizio.
7. Reinstallazione e verifica di conservazione.
8. Disinstallazione, programma rimosso e dati personali ancora identici tramite hash.

I test Node su Windows esercitano anche cifratura/decifratura DPAPI sulle fixture. Questa parte non può essere eseguita su Linux. La reinstallazione automatica usa lo stesso Setup: **non equivale a una prova completa di upgrade reale 3.3.0 → 3.3.1**. La versione 3.3.0 non aveva un installer.

Non sono stati compilati né eseguiti EXE in questo ambiente: Windows, PowerShell e Inno Setup non sono disponibili. La build si ferma esplicitamente su piattaforme non supportate. Il successo della compilazione Windows deve essere confermato dal workflow; non è stato dichiarato come già ottenuto.

## Collaudo finale richiesto prima della Release pubblica

Su Windows 10/11 x64 con account standard e senza Node globale:

1. Compila con il workflow; controlla tutti gli esiti e scarica Setup/checksum.
2. Installa ed esegui la configurazione OAuth con un progetto Google di prova.
3. Salva un Foglio con ARRAYFORMULA, colori, note e commenti, più Apps Script.
4. Apri JSON, Excel e ZIP. Verifica i contenuti e gli avvisi.
5. Usa un token fittizio, un file escluso e uno intoccabile. Controlla lo ZIP e importa una modifica AI di prova.
6. Autorizza la scrittura con lo stesso account. Prova la pubblicazione solo sul progetto di prova; modifica poi Google esternamente e controlla che il conflitto blocchi la scrittura.
7. Avvia il pacchetto originale 3.3.0, crea configurazione/backup fittizi, chiudilo e installa la nuova versione nello stesso profilo. Confronta i dati e apri un vecchio backup.
8. Disinstalla e verifica che profilo e backup restino sul disco.
9. Prova con una porta 47831 occupata e con due clic ravvicinati sul collegamento.
10. Prova finestre strette/larghe e consenso Google negato/scaduto.

Usare sempre documenti di prova per la pubblicazione Apps Script. Nessun collaudo svolto qui ha modificato Google dell'utente.
