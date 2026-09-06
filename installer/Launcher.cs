using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher {
    [STAThread]
    static int Main() {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(powershell,
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "launcher.ps1") + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WorkingDirectory = root;
            using (var child = Process.Start(info)) {
                child.WaitForExit();
                return child.ExitCode;
            }
        } catch (Exception error) {
            MessageBox.Show("Impossibile avviare Google Workspace Backup.\n" + error.Message,
                "Google Workspace Backup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
