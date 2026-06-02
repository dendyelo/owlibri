import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { Entry } from "./main/services/entry";
import type { AppSettings } from "./main/services/settings-db";

type DownloadStatus = "downloading" | "completed" | "error" | "cancelled";

interface DownloadProgressPayload {
  id: string;
  status: DownloadStatus;
  filename?: string;
  total: number;
  progress: number;
}

interface DownloadCompletePayload {
  id: string;
  total: number;
}

interface DownloadErrorPayload {
  id: string;
  error: string;
}

interface MirrorStatusPayload {
  url: string;
  connected: boolean;
}

contextBridge.exposeInMainWorld("api", {
  searchLibgen: (query: string) => ipcRenderer.invoke("search-libgen", query),
  downloadBook: (entry: Entry) => ipcRenderer.invoke("download-book", entry),
  getLocalBooks: () => ipcRenderer.invoke("get-local-books"),
  openBook: (filePath: string) => ipcRenderer.invoke("open-book", filePath),
  deleteBook: (id: string) => ipcRenderer.invoke("delete-book", id),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  getMirrorStatus: () => ipcRenderer.invoke("get-mirror-status"),
  onDownloadProgress: (callback: (data: DownloadProgressPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, data: DownloadProgressPayload) => callback(data);
    ipcRenderer.on("download-progress", subscription);
    return () => {
      ipcRenderer.removeListener("download-progress", subscription);
    };
  },
  onDownloadComplete: (callback: (data: DownloadCompletePayload) => void) => {
    const subscription = (_event: IpcRendererEvent, data: DownloadCompletePayload) => callback(data);
    ipcRenderer.on("download-complete", subscription);
    return () => {
      ipcRenderer.removeListener("download-complete", subscription);
    };
  },
  onDownloadError: (callback: (data: DownloadErrorPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, data: DownloadErrorPayload) => callback(data);
    ipcRenderer.on("download-error", subscription);
    return () => {
      ipcRenderer.removeListener("download-error", subscription);
    };
  },
  onMirrorStatusChanged: (callback: (data: MirrorStatusPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, data: MirrorStatusPayload) => callback(data);
    ipcRenderer.on("mirror-status-changed", subscription);
    return () => {
      ipcRenderer.removeListener("mirror-status-changed", subscription);
    };
  },
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("save-settings", settings),
  getDefaultBookcaseDir: () => ipcRenderer.invoke("get-default-bookcase-dir"),
  selectDirectory: () => ipcRenderer.invoke("select-directory")
});
