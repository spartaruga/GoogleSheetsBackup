import { spawn } from "node:child_process";
import path from "node:path";

export function openBrowser(url) {
  if (process.env.GWB_NO_BROWSER === "1") return;
  let command;
  let args;
  if (process.platform === "win32") {
    command = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = `Start-Process '${String(url).replace(/'/g, "''")}'`;
    args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  } else {
    command = process.platform === "darwin" ? "open" : "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.error("Impossibile aprire il browser. Usa l'indirizzo mostrato dal programma."));
  child.unref();
}
