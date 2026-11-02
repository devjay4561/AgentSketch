Unicode true
!include "LogicLib.nsh"
Name "AgentSketch 이전 버전 복원"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor lzma
Section
  GetFullPathName $0 "$EXEDIR"
  GetFullPathName $1 "$LOCALAPPDATA\Programs\AgentSketch"
  StrCmp $0 $1 0 unsafe
  IfFileExists "$EXEDIR\agentsketch-install.marker" 0 unsafe
  ; Resolve only unambiguous states from an interrupted previous swap.
  IfFileExists "$EXEDIR\AgentSketch.swap.exe" 0 check_previous
  IfFileExists "$EXEDIR\AgentSketch.exe" complete_previous_swap restore_current
  restore_current:
  ClearErrors
  Rename "$EXEDIR\AgentSketch.swap.exe" "$EXEDIR\AgentSketch.exe"
  ${If} ${Errors}
    Goto recovery_failed
  ${EndIf}
  MessageBox MB_OK "중단된 복원 작업에서 원래 실행 파일을 복구했습니다. AgentSketch를 다시 실행할 수 있습니다."
  Goto done
  complete_previous_swap:
  IfFileExists "$EXEDIR\previous\AgentSketch.exe" recovery_failed
  ClearErrors
  Rename "$EXEDIR\AgentSketch.swap.exe" "$EXEDIR\previous\AgentSketch.exe"
  ${If} ${Errors}
    Goto recovery_failed
  ${EndIf}
  MessageBox MB_OK "중단된 버전 복원을 완료했습니다. AgentSketch를 다시 실행하세요."
  Goto done
  recovery_failed:
  MessageBox MB_OK|MB_ICONSTOP "중단된 복원 파일을 자동으로 정리하지 못했습니다. 파일을 지우지 말고 설치 폴더를 확인하세요."
  Goto done
  check_previous:
  IfFileExists "$EXEDIR\previous\AgentSketch.exe" 0 missing
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "AgentSketch를 닫은 뒤 이전 실행 파일로 되돌릴 수 있습니다.$\r$\n$\r$\n문서와 자동 복구 자료는 그대로 둡니다. 새 기능으로 저장한 문서를 구버전에서 다시 저장하면 정보가 사라질 수 있습니다.$\r$\n$\r$\n현재 버전과 이전 버전을 바꾸시겠습니까?" IDCANCEL done
  System::Call 'kernel32::CreateFileW(w "$EXEDIR\AgentSketch.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r1'
  ${If} $1 == -1
    MessageBox MB_OK|MB_ICONSTOP "AgentSketch를 닫고 다시 실행하세요. 실행 파일을 바꾸지 않았습니다."
    Goto done
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r1)'
  ClearErrors
  Rename "$EXEDIR\AgentSketch.exe" "$EXEDIR\AgentSketch.swap.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "AgentSketch를 닫고 다시 실행하세요. 실행 파일을 바꾸지 않았습니다."
    Goto done
  ${EndIf}
  ClearErrors
  Rename "$EXEDIR\previous\AgentSketch.exe" "$EXEDIR\AgentSketch.exe"
  ${If} ${Errors}
    Rename "$EXEDIR\AgentSketch.swap.exe" "$EXEDIR\AgentSketch.exe"
    MessageBox MB_OK|MB_ICONSTOP "이전 버전을 복원하지 못했습니다. 원래 실행 파일을 유지합니다."
    Goto done
  ${EndIf}
  ClearErrors
  Rename "$EXEDIR\AgentSketch.swap.exe" "$EXEDIR\previous\AgentSketch.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "이전 실행 파일로 바꿨지만 직전 버전은 AgentSketch.swap.exe에 남아 있습니다. 파일을 지우지 말고 설치 상태를 확인하세요."
    Goto done
  ${EndIf}
  MessageBox MB_OK "이전 실행 파일로 바꿨습니다. AgentSketch를 다시 실행하세요."
  Goto done
  unsafe:
  MessageBox MB_OK|MB_ICONSTOP "설치 위치가 맞지 않아 파일을 변경하지 않습니다."
  Goto done
  missing:
  MessageBox MB_OK "보관된 이전 실행 파일이 없습니다. 업데이트 설치 시 이전 버전 보관을 선택하세요."
  done:
SectionEnd
