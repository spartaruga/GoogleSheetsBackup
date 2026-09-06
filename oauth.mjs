import http from "node:http";
import crypto from "node:crypto";
import { google } from "googleapis";
import { openBrowser } from "./browser.mjs";

// Keep the existing Google client, but bind its temporary callback to loopback,
// validate state, use PKCE, and always release the listener after five minutes.
export async function authenticateDesktop({ keys, scopes, open = openBrowser, timeoutMs = 300000 }) {
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
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve(client);
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
        if (url.searchParams.has("error")) throw new Error("Accesso Google annullato o negato. Riprova dal programma.");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Codice Google mancante. Riprova dal programma.");
        client.transporter.defaults = { ...client.transporter.defaults, timeout: 30000 };
        const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: redirectUri });
        if (finished) return;
        client.setCredentials(tokens);
        res.end("Accesso completato. Torna a Google Workspace Backup.");
        finish();
      } catch {
        res.end("Accesso non completato. Torna al programma e riprova.");
        // Do not expose OAuth codes/tokens from HTTP library errors.
        finish(new Error("Accesso Google non completato. Controlla consenso e connessione, poi riprova."));
      }
    });
    server.on("error", () => finish(new Error("Impossibile avviare il collegamento locale a Google.")));
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      timer = setTimeout(() => finish(new Error("Tempo per l'accesso Google scaduto. Premi di nuovo Collega account.")), timeoutMs);
      try {
        open(client.generateAuthUrl({
          redirect_uri: redirectUri, access_type: "offline", prompt: "consent",
          scope: scopes, state, code_challenge: challenge, code_challenge_method: "S256",
        }));
      } catch { finish(new Error("Impossibile aprire il browser per l'accesso Google.")); }
    });
  });
}
