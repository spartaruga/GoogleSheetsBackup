# Aggiornamenti: procedura corrente e prossimo passo

## Versione 3.4.0

Il repository ufficiale è `spartaruga/GoogleSheetsBackup`. Il pulsante **Controlla aggiornamenti** consulta la sua Release stabile, confronta la versione numericamente e apre la pagina ufficiale. Il programma non esegue automaticamente installer scaricati. La pipeline pubblica EXE, ZIP sorgente e checksum solo dopo i controlli Windows. Il testo seguente descrive la situazione precedente e i criteri per un eventuale updater automatico.

Oggi l'utente scarica il nuovo Setup da GitHub Releases, chiude il programma e installa nella stessa cartella. Il profilo e i backup sono separati e restano invariati. Non sono implementati download silenziosi, esecuzione automatica di installer o updater in background.

La struttura è già disponibile: versione da package.json, tag vX.Y.Z, naming Setup coerente, file SHA-256, changelog e workflow di build. Non c'è un repository di aggiornamento inventato o hardcoded.

Prossimo passo sensato: dopo aver scelto il repository ufficiale, un pulsante **Controlla aggiornamenti** consulta le release HTTPS del repository fissato dal proprietario, confronta versioni semanticamente e mostra link/note. Niente esecuzione automatica. La risposta remota non deve poter fornire comandi o cambiare arbitrariamente il repository.

Un futuro download integrato deve verificare integrità e autenticità, preferibilmente firma Authenticode e metadati firmati. Un checksum pubblicato accanto al file non protegge da un account repository compromesso. Prima della sostituzione: lavori conclusi, chiusura esplicita, mutex, installer per utente. Nessun passaggio deve sovrascrivere credentials, token, state o backup. Rollback e interruzioni vanno provati in VM.

L'updater completo è rinviato perché serve prima un canale ufficiale di distribuzione, scelta della firma e collaudo Windows. Non risolve un problema necessario al primo installer.
