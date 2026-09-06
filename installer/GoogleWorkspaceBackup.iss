#ifndef AppVersion
  #error "AppVersion must be passed by npm run installer"
#endif
#ifndef SourceDir
  #error "SourceDir must be passed by npm run installer"
#endif
#ifndef ReleaseDir
  #error "ReleaseDir must be passed by npm run installer"
#endif
[Setup]
AppId={{8AC2382C-B51E-4B4C-AB44-0AF2E3FD2A06}
AppName=Google Workspace Backup
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\GoogleWorkspaceBackup
DefaultGroupName=Google Workspace Backup
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayIcon={app}\GoogleWorkspaceBackup.exe
OutputDir={#ReleaseDir}
OutputBaseFilename=GoogleWorkspaceBackup-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\GoogleWorkspaceBackup
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=no

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea un collegamento sul Desktop"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Google Workspace Backup"; Filename: "{app}\GoogleWorkspaceBackup.exe"
Name: "{group}\Diagnostica"; Filename: "{app}\Diagnostica.bat"
Name: "{autodesktop}\Google Workspace Backup"; Filename: "{app}\GoogleWorkspaceBackup.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\GoogleWorkspaceBackup.exe"; Description: "Avvia Google Workspace Backup"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := True;
  if not UninstallSilent then
    MsgBox('Verranno rimossi i file del programma. Credenziali, token, configurazione e backup personali resteranno sul PC.', mbInformation, MB_OK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { The launcher mutex blocks normal running instances before this step.
    Also refuse a direct Node launch that still owns this profile. }
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "' +
    '$p=Join-Path $env:APPDATA ''GoogleWorkspaceBackup\instance.lock''; ' +
    'if(Test-Path -LiteralPath $p){try{$j=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json; ' +
    'if(Get-Process -Id ([int]$j.pid) -ErrorAction SilentlyContinue){exit 1}}catch{exit 1}}; exit 0"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Result := 'Impossibile controllare se il programma e chiuso. Riprova.'
  else if ResultCode <> 0 then
    Result := 'Chiudi Google Workspace Backup con Chiudi programma, poi riprova.';
end;
