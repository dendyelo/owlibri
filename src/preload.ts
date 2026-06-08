import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { Entry } from "./main/services/entry";
import type { AppSettings } from "./main/services/settings-db";
import type { LocalBook } from "./main/services/library-db";

type DownloadStatus = "downloading" | "completed" | "error" | "cancelled";

interface DownloadProgressPayload {
  id: string;
  status: DownloadStatus;
  filename?: string;
  total: number;
  progress: number;
  speed?: number;
}

interface DownloadCompletePayload {
  id: string;
  total: number;
  books: LocalBook[];
  filePath?: string;
  filename?: string;
}

interface DownloadErrorPayload {
  id: string;
  error: string;
}

interface MirrorStatusPayload {
  url: string;
  connected: boolean;
}

interface WindowsUpdateStatusPayload {
  status: "checking" | "available" | "not-available" | "downloaded" | "error";
  message: string;
}

contextBridge.exposeInMainWorld("api", {
  searchLibgen: (query: string, page = 1) => ipcRenderer.invoke("search-libgen", query, page),
  downloadBook: (entry: Entry) => ipcRenderer.invoke("download-book", entry),
  getLocalBooks: () => ipcRenderer.invoke("get-local-books"),
  getDownloadHistory: () => ipcRenderer.invoke("get-download-history"),
  openBook: (filePath: string) => ipcRenderer.invoke("open-book", filePath),
  deleteBook: (id: string) => ipcRenderer.invoke("delete-book", id),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  deleteDownloadHistory: (id: string) => ipcRenderer.invoke("delete-download-history", id),
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
  onWindowsUpdateStatusChanged: (callback: (data: WindowsUpdateStatusPayload) => void) => {
    const subscription = (_event: IpcRendererEvent, data: WindowsUpdateStatusPayload) => callback(data);
    ipcRenderer.on("windows-update-status-changed", subscription);
    return () => {
      ipcRenderer.removeListener("windows-update-status-changed", subscription);
    };
  },
  checkForUpdates: (options?: { manual?: boolean }) => ipcRenderer.invoke("check-for-updates", options),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  resolveCoverImage: (coverUrl: string) => ipcRenderer.invoke("resolve-cover-image", coverUrl),
  getCoverCacheStats: () => ipcRenderer.invoke("get-cover-cache-stats"),
  cleanupCoverCache: () => ipcRenderer.invoke("cleanup-cover-cache"),
  clearCoverCache: () => ipcRenderer.invoke("clear-cover-cache"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("save-settings", settings),
  getDefaultBookcaseDir: () => ipcRenderer.invoke("get-default-bookcase-dir"),
  selectDirectory: () => ipcRenderer.invoke("select-directory")
});
