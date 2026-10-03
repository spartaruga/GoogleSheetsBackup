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
AppMutex={code:GetAppMutex}
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableWelcomePage=yes
SetupLogging=no

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea un collegamento sul Desktop"; Flags: unchecked

[Files]
Source: "CloseApp.ps1"; Flags: dontcopy
Source: "{#SourceDir}\app\app-processes.mjs"; Flags: dontcopy
Source: "{#SourceDir}\runtime\node.exe"; DestName: "gwb-helper-node.exe"; Flags: dontcopy
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Google Workspace Backup"; Filename: "{app}\GoogleWorkspaceBackup.exe"
Name: "{group}\Diagnostica"; Filename: "{app}\Diagnostica.bat"
Name: "{autodesktop}\Google Workspace Backup"; Filename: "{app}\GoogleWorkspaceBackup.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\GoogleWorkspaceBackup.exe"; Description: "Avvia Google Workspace Backup"; Flags: nowait postinstall skipifsilent

[Code]
function GetAppMutex(Param: String): String;
begin
  { Setup shows its own close button; Uninstall keeps the startup protection. }
  if IsUninstaller then Result := 'Local\GoogleWorkspaceBackup'
  else Result := '';
end;

function CheckApp(Mode: String): Integer;
begin
  ExtractTemporaryFile('CloseApp.ps1');
  ExtractTemporaryFile('app-processes.mjs');
  ExtractTemporaryFile('gwb-helper-node.exe');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\CloseApp.ps1') + '" -InstallDirectory "' + ExpandConstant('{app}') +
    '" -HelperDirectory "' + ExpandConstant('{tmp}') + '" ' + Mode,
    '', SW_HIDE, ewWaitUntilTerminated, Result) then Result := 4;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if not UninstallSilent then
    MsgBox('Verranno rimossi i file del programma. Credenziali, token, configurazione e backup personali resteranno sul PC.', mbInformation, MB_OK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode, Attempt: Integer;
begin
  Result := '';
  ResultCode := CheckApp('-Mode Check');
  if (ResultCode = 1) and not WizardSilent then begin
    if TaskDialogMsgBox('Google Workspace Backup e aperto',
      'Per aggiornare occorre chiudere il programma. Le operazioni in corso impediscono la chiusura; dati e backup salvati vengono conservati.',
      mbInformation, MB_OKCANCEL, ['Chiudi l''app e continua', 'Annulla aggiornamento'], 0) = IDOK then
      ResultCode := CheckApp('-Mode Close');
  end;
  if (ResultCode = 3) and not WizardSilent then begin
    if MsgBox('Alcune istanze verificate non rispondono. Chiuderle forzatamente? Eventuali operazioni non salvate possono andare perse.', mbConfirmation, MB_YESNO) = IDYES then
      ResultCode := CheckApp('-Mode Close -Force');
  end;
  if ResultCode = 0 then begin
    { Node exits first; wait for cmd, PowerShell and the EXE launcher too. }
    for Attempt := 1 to 150 do begin
      if not CheckForMutexes('Local\GoogleWorkspaceBackup') then Exit;
      Sleep(100);
    end;
    ResultCode := 3;
  end;
  case ResultCode of
    1: Result := 'Chiudi Google Workspace Backup oppure riprova e scegli Chiudi l''app e continua.';
    2: Result := 'Operazione in corso. Attendi il termine oppure annulla il backup dall''app, poi riprova.';
    3: Result := 'La chiusura del programma non e terminata. Attendi e riprova. Nessun processo e stato forzato.';
  else
    Result := 'Il programma non risponde o il blocco locale non e verificabile. Chiudilo manualmente e riprova. Nessun processo e stato forzato.';
  end;
end;
