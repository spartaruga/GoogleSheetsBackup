import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// One owner per user data directory, including launches using npm start.
// A stale/corrupt record never authorizes termination of another process.
export function claimInstance(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dataDirectory, "instance.lock");
  const recordPath = path.join(dataDirectory, "instance.json");
  const id = crypto.randomUUID();
  let fd;
  try { fd = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); }
    catch { throw new Error("Avvio già in corso o blocco locale non leggibile. Attendi e riprova; vedi README se persiste."); }
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error("Blocco locale non valido. Vedi README.");
    try { process.kill(owner.pid, 0); return null; }
    catch (e) { if (e.code !== "ESRCH") return null; }
    // Serialize stale-lock recovery too. A simultaneous launch fails safely.
    const recovery = `${lockPath}.recovery`;
    const recoverFd = fs.openSync(recovery, "wx", 0o600);
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (current.id !== owner.id) return null;
      fs.unlinkSync(lockPath);
      fd = fs.openSync(lockPath, "wx", 0o600);
    } finally { fs.closeSync(recoverFd); fs.unlinkSync(recovery); }
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, id }));
  fs.closeSync(fd);
  const release = () => {
    try {
      if (JSON.parse(fs.readFileSync(lockPath, "utf8")).id !== id) return;
      fs.rmSync(recordPath, { force: true });
      fs.unlinkSync(lockPath);
    } catch { /* A stale lock can be recovered on next launch. */ }
  };
  process.once("exit", release);
  return {
    id, release,
    publish(version, port) {
      const record = { app: "GoogleWorkspaceBackup", version, pid: process.pid, instanceId: id, port };
      fs.writeFileSync(`${recordPath}.tmp`, JSON.stringify(record), { mode: 0o600 });
      fs.renameSync(`${recordPath}.tmp`, recordPath);
    },
  };
}
