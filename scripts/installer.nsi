Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"
!ifndef SOURCE
!error "SOURCE is required"
!endif
!ifndef OUTPUT
!error "OUTPUT is required"
!endif
!ifndef VERSION
!define VERSION "0.1.1"
!endif
Name "AgentSketch"
OutFile "${OUTPUT}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\AgentSketch"
SetCompressor /SOLID lzma
BrandingText "AgentSketch · 로컬 업무 도식 편집기"
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "AgentSketch Installer"
VIAddVersionKey "FileDescription" "AgentSketch 사용자별 설치 프로그램"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AgentSketch"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "AgentSketch를 현재 사용자 계정에 설치합니다. 관리자 권한은 필요하지 않습니다.$\r$\n$\r$\n기존 AgentSketch 창을 닫고 진행하세요. 문서와 자동 복구 자료는 설치·제거 시 지우지 않습니다.$\r$\n$\r$\n이 배포 파일은 코드 서명이 없습니다. Windows가 확인되지 않은 게시자로 표시할 수 있습니다."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\AgentSketch.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Function .onInit
  SetShellVarContext current
  ; Fixed per-user folder: never trust an arbitrary registry installation path.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\AgentSketch"
FunctionEnd

Section "AgentSketch 프로그램 (필수)" Main
  SectionIn RO
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\AgentSketch.swap.exe" 0 recover_replacement
  MessageBox MB_OK|MB_ICONSTOP "완료되지 않은 버전 복원이 있습니다. 설치 폴더의 AgentSketch-Rollback.exe를 먼저 실행해 복구한 뒤 설치하세요."
  Abort
  recover_replacement:
  ; Recover the two possible states left by an interrupted executable swap.
  IfFileExists "$INSTDIR\AgentSketch.replacing.exe" 0 stage_new
  IfFileExists "$INSTDIR\AgentSketch.exe" cleanup_replacement restore_replacement
  restore_replacement:
  ClearErrors
  Rename "$INSTDIR\AgentSketch.replacing.exe" "$INSTDIR\AgentSketch.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "중단된 설치의 실행 파일을 복구하지 못했습니다. 앱을 닫고 다시 시도하세요."
    Abort
  ${EndIf}
  Goto stage_new
  cleanup_replacement:
  ClearErrors
  Delete "$INSTDIR\AgentSketch.replacing.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "중단된 설치 파일을 정리하지 못했습니다. 앱을 닫고 다시 시도하세요."
    Abort
  ${EndIf}
  stage_new:
  File /oname=AgentSketch.pending.exe "${SOURCE}\AgentSketch.exe"
  IfFileExists "$INSTDIR\AgentSketch.exe" 0 install_new
  ; Request an exclusive write handle without changing bytes; a running image
  ; cannot satisfy this check. Never terminate the user's editing process.
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\AgentSketch.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r1'
  ${If} $1 == -1
    Delete "$INSTDIR\AgentSketch.pending.exe"
    MessageBox MB_OK|MB_ICONSTOP "AgentSketch가 실행 중이거나 실행 파일이 잠겨 있습니다. 작업을 저장하고 앱을 닫은 뒤 다시 설치하세요."
    Abort
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r1)'
  ; The optional fourth section controls the single rollback copy.
  SectionGetFlags 3 $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 <> 0
    CreateDirectory "$INSTDIR\previous"
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\AgentSketch.exe" "$INSTDIR\previous\AgentSketch.exe"
    ${If} ${Errors}
      Delete "$INSTDIR\AgentSketch.pending.exe"
      MessageBox MB_OK|MB_ICONSTOP "이전 실행 파일을 보관하지 못했습니다. 설치를 중단합니다."
      Abort
    ${EndIf}
  ${EndIf}
  ClearErrors
  Rename "$INSTDIR\AgentSketch.exe" "$INSTDIR\AgentSketch.replacing.exe"
  ${If} ${Errors}
    Delete "$INSTDIR\AgentSketch.pending.exe"
    MessageBox MB_OK|MB_ICONSTOP "AgentSketch가 실행 중이거나 파일을 바꿀 수 없습니다. 작업을 저장하고 앱을 닫은 뒤 다시 설치하세요."
    Abort
  ${EndIf}
  install_new:
  ClearErrors
  Rename "$INSTDIR\AgentSketch.pending.exe" "$INSTDIR\AgentSketch.exe"
  ${If} ${Errors}
    Rename "$INSTDIR\AgentSketch.replacing.exe" "$INSTDIR\AgentSketch.exe"
    MessageBox MB_OK|MB_ICONSTOP "새 실행 파일을 배치하지 못했습니다. 설치를 중단합니다."
    Abort
  ${EndIf}
  Delete "$INSTDIR\AgentSketch.replacing.exe"
  File "${SOURCE}\THIRD-PARTY-NOTICES.txt"
  File "${SOURCE}\agentsketch.cmd"
  File /r "${SOURCE}\AI"
  File "NSIS-LICENSE.txt"
  File /oname=AgentSketch-Rollback.exe "${ROLLBACK}"
  FileOpen $0 "$INSTDIR\agentsketch-install.marker" w
  FileWrite $0 "AgentSketch managed installation v1"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\AgentSketch" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "DisplayName" "AgentSketch"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "Publisher" "AgentSketch"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "DisplayIcon" "$INSTDIR\AgentSketch.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch" "NoRepair" 1
SectionEnd

Section "시작 메뉴 바로가기" Shortcuts
  CreateDirectory "$SMPROGRAMS\AgentSketch"
  CreateShortcut "$SMPROGRAMS\AgentSketch\AgentSketch.lnk" "$INSTDIR\AgentSketch.exe"
  CreateShortcut "$SMPROGRAMS\AgentSketch\이전 버전으로 되돌리기.lnk" "$INSTDIR\AgentSketch-Rollback.exe"
  CreateShortcut "$SMPROGRAMS\AgentSketch\AgentSketch 제거.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "AGENTSKETCH 파일 열기 등록" Association
  ReadRegStr $0 HKCU "Software\Classes\.agentsketch" ""
  ${If} $0 != "AgentSketch.Document"
    WriteRegStr HKCU "Software\AgentSketch" "PreviousAssociation" "$0"
  ${EndIf}
  WriteRegStr HKCU "Software\Classes\.agentsketch" "" "AgentSketch.Document"
  WriteRegStr HKCU "Software\Classes\AgentSketch.Document" "" "AgentSketch 문서"
  WriteRegStr HKCU "Software\Classes\AgentSketch.Document\DefaultIcon" "" '$\"$INSTDIR\AgentSketch.exe$\",0'
  WriteRegStr HKCU "Software\Classes\AgentSketch.Document\shell\open\command" "" '$\"$INSTDIR\AgentSketch.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\AgentSketch.exe\shell\open\command" "" '$\"$INSTDIR\AgentSketch.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\AgentSketch.exe\SupportedTypes" ".agentsketch" ""
  WriteRegStr HKCU "Software\AgentSketch\Capabilities" "ApplicationName" "AgentSketch"
  WriteRegStr HKCU "Software\AgentSketch\Capabilities\FileAssociations" ".agentsketch" "AgentSketch.Document"
  WriteRegStr HKCU "Software\RegisteredApplications" "AgentSketch" "Software\AgentSketch\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section /o "업데이트 전 실행 파일 1개 보관" Backup
  ; Main section performs the copy before replacing the running image.
SectionEnd

Function un.onInit
  SetShellVarContext current
  GetFullPathName $0 "$INSTDIR"
  GetFullPathName $1 "$LOCALAPPDATA\Programs\AgentSketch"
  StrCmp $0 $1 0 unsafe_uninstall
  IfFileExists "$INSTDIR\agentsketch-install.marker" 0 unsafe_uninstall
  Return
  unsafe_uninstall:
  MessageBox MB_OK|MB_ICONSTOP "설치 위치를 확인할 수 없어 제거를 중단합니다."
  Abort
FunctionEnd

Section "Uninstall"
  ClearErrors
  Delete "$INSTDIR\AgentSketch.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "작업을 저장하고 AgentSketch를 닫은 뒤 다시 제거하세요."
    Abort
  ${EndIf}
  Delete "$INSTDIR\AgentSketch.pending.exe"
  Delete "$INSTDIR\AgentSketch.replacing.exe"
  Delete "$INSTDIR\AgentSketch.swap.exe"
  Delete "$INSTDIR\AgentSketch-Rollback.exe"
  Delete "$INSTDIR\previous\AgentSketch.exe"
  RMDir "$INSTDIR\previous"
  Delete "$INSTDIR\사용안내.md"
  Delete "$INSTDIR\검증결과.md"
  Delete "$INSTDIR\업그레이드범위.md"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\AI-사용안내.md"
  Delete "$INSTDIR\agentsketch.cmd"
  !include "${AI_UNINSTALL}"
  Delete "$INSTDIR\NSIS-LICENSE.txt"
  Delete "$INSTDIR\agentsketch-install.marker"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\AgentSketch\AgentSketch.lnk"
  Delete "$SMPROGRAMS\AgentSketch\이전 버전으로 되돌리기.lnk"
  Delete "$SMPROGRAMS\AgentSketch\AgentSketch 제거.lnk"
  RMDir "$SMPROGRAMS\AgentSketch"
  ReadRegStr $0 HKCU "Software\Classes\.agentsketch" ""
  ${If} $0 == "AgentSketch.Document"
    ReadRegStr $1 HKCU "Software\AgentSketch" "PreviousAssociation"
    ${If} $1 == ""
      DeleteRegValue HKCU "Software\Classes\.agentsketch" ""
      DeleteRegKey /ifempty HKCU "Software\Classes\.agentsketch"
    ${Else}
      WriteRegStr HKCU "Software\Classes\.agentsketch" "" "$1"
    ${EndIf}
  ${EndIf}
  DeleteRegKey HKCU "Software\Classes\AgentSketch.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\AgentSketch.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "AgentSketch"
  DeleteRegKey HKCU "Software\AgentSketch\Capabilities"
  DeleteRegValue HKCU "Software\AgentSketch" "InstallDir"
  DeleteRegValue HKCU "Software\AgentSketch" "PreviousAssociation"
  DeleteRegKey /ifempty HKCU "Software\AgentSketch"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSketch"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; APPDATA\AgentSketch and user documents are deliberately preserved.
SectionEnd
