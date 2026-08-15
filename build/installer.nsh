!macro customInstall
  CreateShortCut "$DESKTOP\KitsuneServ Terminal.lnk" "$INSTDIR\KitsuneServ.exe" "--open-terminal" "$INSTDIR\KitsuneServ.exe" 0 SW_SHOWNORMAL "" "KitsuneServ Terminal"
  CreateShortCut "$DESKTOP\KitsuneServ File Manager.lnk" "$INSTDIR\KitsuneServ.exe" "--open-file-manager" "$INSTDIR\KitsuneServ.exe" 0 SW_SHOWNORMAL "" "KitsuneServ File Manager"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\KitsuneServ Terminal.lnk"
  Delete "$DESKTOP\KitsuneServ File Manager.lnk"
!macroend
