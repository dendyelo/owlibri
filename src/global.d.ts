/// <reference types="vite/client" />

import type { Entry } from "./main/services/entry";
import type { LocalBook } from "./main/services/library-db";

interface DownloadProgress {
  id: string;
  status: "downloading" | "completed" | "error" | "cancelled";
  filename?: string;
  total: number;
  progress: number;
  speed?: number;
}

interface DownloadComplete {
  id: string;
  total: number;
  books: LocalBook[];
}

interface DownloadError {
  id: string;
  error: string;
}

interface ElectronAPI {
  searchLibgen: (query: string) => Promise<Entry[]>;
  downloadBook: (entry: Entry) => Promise<{ success: boolean; path?: string; error?: string }>;
  getLocalBooks: () => Promise<LocalBook[]>;
  openBook: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  deleteBook: (id: string) => Promise<LocalBook[]>;
  cancelDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
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
  getSettings: () => Promise<{ bookcaseDir: string }>;
  saveSettings: (settings: Partial<{ bookcaseDir: string }>) => Promise<{ bookcaseDir: string }>;
  getDefaultBookcaseDir: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
