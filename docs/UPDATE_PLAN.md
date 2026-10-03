# Aggiornamenti applicativi senza Actions

Versione 3.5.0. `Aggiorna-GWB.cmd` e il pulsante **Controlla aggiornamenti** scaricano il pacchetto applicativo dal canale ufficiale `spartaruga/GoogleSheetsBackup`. Le Release EXE rimangono disponibili per la prima installazione e gli aggiornamenti del runtime. Il workflow Windows non ha eventi automatici.

## Preparazione e pubblicazione

1. Mantieni invariati runtime, dipendenze e risoluzioni del lockfile per un aggiornamento ZIP. Cambia la versione in package.json e nelle due posizioni del lockfile; aggiorna il changelog.
2. Esegui `npm test`, `npm run self-test`, `npm run check:repo`, `git diff --check` e `npm run update:package`. Il packager crea `release/GoogleWorkspaceBackup-Update-X.Y.Z.zip`, checksum, `packages/vX.Y.Z.json` e il file autonomo `Aggiorna-GWB.cmd`. Non esegue `npm run build`, Inno o Actions.
3. Controlla ancora `npm run check:repo`: decodifica i pacchetti testuali, verifica manifest e hash e scansiona il contenuto, senza inserire profili o backup.
4. Integra sorgente e pacchetto versionato senza toccare pacchetti già pubblicati. Il formato JSON contiene il ZIP in base64 per permettere pubblicazione tramite normali operazioni Git, senza servizi di upload o runner.
5. Calcola l’identità del blob dell’envelope con `git hash-object packages/vX.Y.Z.json`. Crea `packages/stable.json` con format `gwb-update-channel-v1`, version, packageBlob (SHA Git), sha256 (SHA-256 ZIP), size (byte ZIP), sourceCommit (commit del codice), notes e publishedAt. Promuovi il canale in un commit separato dopo aver verificato che il blob esista su GitHub.
6. Verifica download del blob, identità Git, checksum ZIP e contenuto del manifest. Il controllo dell’app usa solo URL costruiti del repository ufficiale; nessun URL o comando proveniente dal canale viene eseguito.

Non occorre una nuova Release GitHub per ogni modifica applicativa. La pubblicazione di un nuovo installer EXE resta un’operazione distinta e manuale, con il relativo collaudo Windows. Puoi anche allegare il ZIP applicativo a una Release manualmente senza consumare Actions; il canale stabile rimane l’indice dell’updater.

## Applicazione e ripristino

Il bootstrap è un singolo CMD con lo script PowerShell incorporato; non richiede Node globale. Riutilizza l’installazione registrata in Windows. Se manca, scarica Node e il Setup 3.4.5 da URL fissati e controlla i rispettivi SHA-256. Credenziali, token, stato, ID, inventari e backup restano nel profilo esterno.

Prima di sostituire file, verifica il ZIP e cerca tutte le istanze dello stesso proprietario e sessione. Verifica il percorso del server/launcher e il package del programma. Le porte di ascolto appartengono al PID verificato. Un server con lavoro noto in corso blocca la chiusura anche con force. Un server non responsivo viene forzato solo con conferma; identità, creazione e percorso vengono riletti subito prima di terminare il PID. L’istanza corrente e i suoi antenati sono protetti dal pulsante nell’app. Non si termina per nome né si chiude un albero di processi generico.

Il worker acquisisce il mutex del launcher e il blocco del profilo. Sostituisce app/ tramite rinomine sullo stesso volume, riutilizzando node_modules. Ogni rinomina ha un journal. Avvia il nuovo server in modalità di verifica: solo health/shutdown sono accessibili. Dopo la prova chiude quel server e riavvia il launcher normale. Un fallimento ripristina il codice precedente. `.gwb-previous` conserva la copia immediatamente precedente; eventuali copie più vecchie sono mantenute con un suffisso, senza cancellare aggiunte locali.

Se il PC si spegne a metà aggiornamento, avvia nuovamente `Aggiorna-GWB.cmd`: il worker riprende il ripristino dal journal prima di tentare l’installazione. Non cancellare `.gwb-update` manualmente. Se il journal è invalido l’aggiornamento si ferma e conserva i file per analisi.

I test automatici della logica, dei guasti e dell’avvio reale sono locali. Gli adattatori CIM, PowerShell e il CMD richiedono una prova nativa su Windows; questa versione non avvia un runner per effettuarla. Le operazioni Google usano fixture nei test, nessun account reale.
