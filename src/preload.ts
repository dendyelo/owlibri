import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  searchLibgen: (query: string) => ipcRenderer.invoke("search-libgen", query),
  downloadBook: (entry: any) => ipcRenderer.invoke("download-book", entry),
  getLocalBooks: () => ipcRenderer.invoke("get-local-books"),
  openBook: (filePath: string) => ipcRenderer.invoke("open-book", filePath),
  deleteBook: (id: string) => ipcRenderer.invoke("delete-book", id),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  getMirrorStatus: () => ipcRenderer.invoke("get-mirror-status"),
  onDownloadProgress: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("download-progress", subscription);
    return () => {
      ipcRenderer.removeListener("download-progress", subscription);
    };
  },
  onDownloadComplete: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("download-complete", subscription);
    return () => {
      ipcRenderer.removeListener("download-complete", subscription);
    };
  },
  onDownloadError: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("download-error", subscription);
    return () => {
      ipcRenderer.removeListener("download-error", subscription);
    };
  },
  onMirrorStatusChanged: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("mirror-status-changed", subscription);
    return () => {
      ipcRenderer.removeListener("mirror-status-changed", subscription);
    };
  }
});
