import http from "node:http";
import crypto from "node:crypto";
import { google } from "googleapis";
import { openBrowser } from "./browser.mjs";

// Keep the existing Google client, but bind its temporary callback to loopback,
// validate state, use PKCE, and always release the listener after two minutes.
// A shorter timeout avoids leaving the desktop UI apparently frozen when the
// browser is closed or Google never returns to the loopback callback.
export async function authenticateDesktop({
  keys,
  scopes,
  open = openBrowser,
  timeoutMs = 120000,
  signal,
  onUrl,
}) {
  const client = new google.auth.OAuth2(keys.client_id, keys.client_secret);
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return new Promise((resolve, reject) => {
    let timer;
    let redirectUri;
    let exchanging = false;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try { server.close(); } catch {}
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      if (error) reject(error);
      else resolve(client);
    };
    const abort = () => finish(new Error("Collegamento Google annullato."));
    const finishAfterResponse = (res, error) => {
      res.once("finish", () => finish(error));
    };
    const server = http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      const url = new URL(req.url, redirectUri);
      if (req.method !== "GET" || url.pathname !== "/oauth2callback" || url.searchParams.get("state") !== state) {
        res.writeHead(400).end("Callback non valido.");
        return;
      }
      if (exchanging) { res.writeHead(409).end("Accesso in corso."); return; }
      exchanging = true;
      try {
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          const message = oauthError === "access_denied"
            ? "Accesso Google annullato o negato. Riprova dal programma."
            : `Google ha rifiutato l'accesso (${oauthError}). Riprova dal programma.`;
          finishAfterResponse(res, new Error(message));
          res.writeHead(400).end("Accesso Google non completato. Puoi chiudere questa scheda e tornare al programma.");
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          finishAfterResponse(res, new Error("Codice Google mancante. Riprova dal programma."));
          res.writeHead(400).end("Codice Google mancante. Puoi chiudere questa scheda e tornare al programma.");
          return;
        }
        client.transporter.defaults = { ...client.transporter.defaults, timeout: 30000 };
        const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: redirectUri });
        if (finished) return;
        client.setCredentials(tokens);
        finishAfterResponse(res);
        res.end("Accesso completato. Puoi chiudere questa scheda e tornare a Google Workspace Backup.");
      } catch (error) {
        const googleCode = String(error?.response?.data?.error || "");
        let message = "Accesso Google non completato. Controlla consenso e connessione, poi riprova.";
        if (googleCode === "redirect_uri_mismatch") {
          message = "Redirect OAuth rifiutato da Google. Verifica che il JSON sia di tipo Applicazione desktop.";
        } else if (googleCode === "invalid_client") {
          message = "Credenziali OAuth rifiutate da Google. Scarica di nuovo il JSON del client Desktop.";
        } else if (googleCode === "invalid_grant") {
          message = "Google ha rifiutato il codice di accesso. Premi di nuovo Collega account e completa il consenso una sola volta.";
        }
        finishAfterResponse(res, new Error(message));
        res.writeHead(400).end("Accesso Google non completato. Puoi chiudere questa scheda e tornare al programma.");
      }
    });
    server.on("error", () => finish(new Error("Impossibile avviare il collegamento locale a Google.")));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    server.listen(0, "127.0.0.1", () => {
      if (signal?.aborted) return abort();
      redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      timer = setTimeout(() => finish(new Error("Tempo per l'accesso Google scaduto. Premi di nuovo Collega account.")), timeoutMs);
      try {
        const authUrl = client.generateAuthUrl({
          redirect_uri: redirectUri, access_type: "offline", prompt: "consent select_account",
          include_granted_scopes: true,
          scope: scopes, state, code_challenge: challenge, code_challenge_method: "S256",
        });
        onUrl?.(authUrl);
        open(authUrl);
      } catch { finish(new Error("Impossibile aprire il browser per l'accesso Google.")); }
    });
  });
}
