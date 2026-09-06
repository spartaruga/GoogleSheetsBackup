# Verifiche della versione 3.3.1

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
