Unicode True
Name "DEXCARGO Desktop"
Caption "DEXCARGO Desktop Setup"
OutFile "release/DEXCARGO-Desktop-Setup-1.2.4-NSIS.exe"
InstallDir "$LOCALAPPDATA\Programs\DEXCARGO Desktop"
InstallDirRegKey HKCU "Software\DEXCARGO Desktop" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "DEXCARGO Desktop"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "1.2.4.0"
VIAddVersionKey "ProductName" "DEXCARGO Desktop"
VIAddVersionKey "ProductVersion" "1.2.4"
VIAddVersionKey "FileDescription" "DEXCARGO Desktop Windows Setup"

!include "MUI2.nsh"
!define MUI_ICON "public/assets/dexcargo.ico"
!define MUI_UNICON "public/assets/dexcargo.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\DEXCARGO Desktop.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch DEXCARGO Desktop"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "DEXCARGO Desktop" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "release/win-unpacked/*"

  CreateDirectory "$SMPROGRAMS\DEXCARGO Desktop"
  CreateShortcut "$SMPROGRAMS\DEXCARGO Desktop\DEXCARGO Desktop.lnk" "$INSTDIR\DEXCARGO Desktop.exe" "" "$INSTDIR\DEXCARGO Desktop.exe" 0
  CreateShortcut "$DESKTOP\DEXCARGO Desktop.lnk" "$INSTDIR\DEXCARGO Desktop.exe" "" "$INSTDIR\DEXCARGO Desktop.exe" 0
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\DEXCARGO Desktop" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "DisplayName" "DEXCARGO Desktop"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "DisplayVersion" "1.2.4"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "Publisher" "DEXCARGO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "DisplayIcon" "$INSTDIR\DEXCARGO Desktop.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\DEXCARGO Desktop\DEXCARGO Desktop.lnk"
  RMDir "$SMPROGRAMS\DEXCARGO Desktop"
  Delete "$DESKTOP\DEXCARGO Desktop.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DEXCARGO Desktop"
  DeleteRegKey HKCU "Software\DEXCARGO Desktop"
  RMDir /r "$INSTDIR"
SectionEnd
