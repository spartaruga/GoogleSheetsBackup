Option Explicit
Dim shell, fso, baseDir, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File """ & baseDir & "\launcher.ps1"""
exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  MsgBox "Il programma non si e avviato. Apri Avvia_visibile.bat per vedere l'errore.", vbCritical, "Google Workspace Backup"
End If
