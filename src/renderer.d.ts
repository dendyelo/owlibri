import { Entry } from "./main/services/entry";
import { LocalBook } from "./main/services/library-db";

export interface DownloadProgress {
  id: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  filename: string;
  total: number;
  progress: number;
}

export interface DownloadComplete {
  id: string;
  books: LocalBook[];
}

export interface DownloadError {
  id: string;
  error: string;
}

export interface ElectronAPI {
  searchLibgen: (query: string) => Promise<Entry[]>;
  downloadBook: (entry: Entry) => Promise<{ success: boolean; path?: string; error?: string }>;
  getLocalBooks: () => Promise<LocalBook[]>;
  openBook: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  deleteBook: (id: string) => Promise<LocalBook[]>;
  cancelDownload: (id: string) => Promise<void>;
  getMirrorStatus: () => Promise<{ url: string; connected: boolean }>;
  onDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void;
  onDownloadComplete: (callback: (data: DownloadComplete) => void) => () => void;
  onDownloadError: (callback: (data: DownloadError) => void) => () => void;
  onMirrorStatusChanged: (callback: (data: { url: string; connected: boolean }) => void) => () => void;
  checkForUpdates: () => Promise<{
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    releaseUrl?: string;
  }>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
