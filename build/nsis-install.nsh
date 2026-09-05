; Custom NSIS install logic for ShopKeeper POS
; Deletes old desktop and start-menu shortcuts so that fresh shortcuts
; with correct icons are recreated by electron-builder during install/update.

; Request user-level execution (no admin/UAC required)
RequestExecutionLevel user

!macro customInstall
  ; Remove stale desktop shortcuts (old icon / broken link cleanup)
  Delete "$DESKTOP\ShopKeeper POS.lnk"
  Delete "$DESKTOP\ShopKeeper POS (x86).lnk"
  Delete "$DESKTOP\ShopKeeper.POS.lnk"
  ; Remove stale start-menu shortcuts
  Delete "$SMPROGRAMS\ShopKeeper POS.lnk"
  Delete "$SMPROGRAMS\ShopKeeper POS (x86).lnk"
  ; Also clear any within a product folder (older installers used a sub-directory)
  RMDir /r "$SMPROGRAMS\ShopKeeper POS"
!macroend
