// electron-updater shim — only `updater.ts` (not bundled) imports this, but keep a
// stub so any accidental reference resolves without pulling the real package.
export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: () => undefined,
  checkForUpdates: async (): Promise<undefined> => undefined,
  downloadUpdate: async (): Promise<undefined> => undefined,
  quitAndInstall: (): void => {},
};
export default { autoUpdater };
