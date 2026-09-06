# Proposta futura: Backup questo progetto

## Obiettivo

Quando l'utente è su un Foglio Google, preme l'estensione e sceglie **Backup questo progetto**. Questa versione non implementa l'estensione: prima va collaudata la distribuzione Windows.

## Flusso proposto

1. Il clic concede l'accesso alla scheda attiva (`activeTab`). Un controllo locale riconosce esclusivamente una URL `docs.google.com/spreadsheets/d/...` e ricava lo Spreadsheet ID.
2. Il popup mostra titolo/ID e l'eventuale Script ID associato. L'utente conferma il progetto.
3. Se manca l'associazione, il popup chiede di aprire nel Foglio **Estensioni → Apps Script**.
4. Nella scheda dell'editor Apps Script l'utente clicca di nuovo l'estensione e sceglie **Associa a questo Foglio**. Si legge lo Script ID dalla URL supportata; se non disponibile, l'utente lo copia dalle impostazioni.
5. Si mostra la coppia Foglio/Script prima di salvarla. Quando possibile, `projects.get` verifica il `parentId`. Un valore diverso richiede correzione esplicita, senza associazioni silenziose.
6. L'associazione viene salvata localmente. Poi si apre la stessa revisione privacy dell'app desktop prima dell'export.

**Limite essenziale:** non esiste in questa proposta un'affidabile ricerca inversa generale Spreadsheet ID → Script ID. Non si assume che Drive elenchi sempre gli script container-bound. I metadati del progetto con ID già conosciuto possono contenere `parentId`, ma questo non equivale a un endpoint di scoperta inversa. Le associazioni vanno memorizzate per account, con possibilità di rimuoverle/correggerle.

## Prima versione consigliata: delega al desktop

Mantenere una sola implementazione del formato backup e dei controlli, nel programma desktop. L'estensione invia solo un'intenzione di backup con gli ID; login, API Google, snapshot, ZIP e revisione privacy restano nell'app esistente. Non duplicare refresh token nel browser.

Usare **Native Messaging**: l'installer potrà registrare per l'utente un host dedicato con elenco degli ID estensione autorizzati. Il bridge valida lunghezza, schema e nomi dei messaggi; nessun percorso o comando arbitrario. Il messaggio apre una conferma locale e non autorizza pubblicazioni su Google. Non aprire l'attuale server HTTP a tutte le estensioni o aggiungere CORS permissivo.

Schema concettuale minimo: tipo `requestBackup`, `spreadsheetId`, `scriptId` facoltativo e un identificativo richiesta. Il desktop sceglie la destinazione già configurata e chiede conferma se il progetto è nuovo. Il bridge non riceve sorgenti da eseguire, credenziali o percorsi scrivibili.

La registrazione Native Messaging e l'ID stabile dell'estensione richiedono una build e una scelta di distribuzione dedicate. Non sono presenti nell'installer di questa versione.

## Possibile versione autonoma, successiva

- Manifest V3 con popup, service worker e risorse locali.
- OAuth tramite `chrome.identity`, client OAuth specifico dell'estensione e ID stabile; nessun client secret Desktop copiato dentro l'estensione.
- `drive.readonly`, `spreadsheets.readonly`, `script.projects.readonly`; eventuale scrittura come funzione separata futura.
- API Sheets/Drive/Apps Script con la stessa struttura di snapshot, indici e manifest AI `formatVersion: 1.0`.
- ZIP e privacy nel browser: vanno progettati considerando memoria, dimensioni Fogli, download e sospensione del service worker.
- Permessi richiesti solo quando servono: `activeTab`, `storage`, `identity`, `downloads`; `nativeMessaging` solo nella variante desktop. Eventuali host permissions API devono essere limitate ai servizi effettivamente usati.
- Associazioni locali tramite `storage.local`; evitare di sincronizzare token e identificativi aziendali senza scelta consapevole.

## Criteri di accettazione

- Primo abbinamento con Foglio corretto verificabile; nessuna associazione automatica basata sul solo titolo.
- Più account Google e più Fogli aperti non scambiano le associazioni.
- Backup desktop ed estensione producono manifest e hash compatibili su fixture condivise.
- File esclusi/intoccabili e token censurati rispettano le stesse regole.
- Account senza accesso, script sconosciuto, Foglio grande e browser chiuso danno feedback esplicito.
- Nessuna pubblicazione o invio a un'AI automatica al solo clic “Backup”.

Fonti da usare nell'implementazione: [progetti container-bound](https://developers.google.com/apps-script/guides/bound), [metadati Project](https://developers.google.com/apps-script/api/reference/rest/v1/projects), [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
