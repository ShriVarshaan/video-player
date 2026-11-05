; Always per user: no "all users" page in the wizard, and no admin password.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The data folder is %APPDATA%\video-player, whatever the product is called (src/main/paths.ts),
; so electron-builder's own delete-data option wouldn't find it. An update runs this uninstaller
; silently: isUpdated keeps it from asking, and /SD answers No for any other silent uninstall.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Cinewall library, watch progress and saved logins?$\r$\n$\r$\nYour video files are not touched either way." /SD IDNO IDNO cinewallKeepData
    ; App data is always per user, even if someone forced an all-users install from the command line.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    RMDir /r "$APPDATA\video-player"
    cinewallKeepData:
  ${endIf}
!macroend
