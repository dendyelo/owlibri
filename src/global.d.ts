/// <reference types="vite/client" />

import type { Entry } from "./main/services/entry";
import type { DownloadHistoryItem } from "./main/services/download-history";
import type { LocalBook } from "./main/services/library-db";
import type { CoverCacheStats } from "./main/services/cover-cache";
import type { AppSettings } from "./main/services/settings-db";

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
  filePath?: string;
  filename?: string;
}

interface DownloadError {
  id: string;
  error: string;
}

interface ElectronAPI {
  searchLibgen: (query: string, page?: number) => Promise<{
    success: boolean;
    entries: Entry[];
    error?: string;
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalResults?: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }>;
  downloadBook: (entry: Entry) => Promise<{ success: boolean; path?: string; error?: string }>;
  getLocalBooks: () => Promise<LocalBook[]>;
  getDownloadHistory: () => Promise<DownloadHistoryItem[]>;
  openBook: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  deleteBook: (id: string) => Promise<LocalBook[]>;
  cancelDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  deleteDownloadHistory: (id: string) => Promise<DownloadHistoryItem[]>;
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
    channel?: "stable" | "pre";
  }>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  resolveCoverImage: (coverUrl: string) => Promise<{ success: boolean; coverUrl?: string; error?: string }>;
  getCoverCacheStats: () => Promise<CoverCacheStats>;
  cleanupCoverCache: () => Promise<{ removed: number; kept: number; total: number; protectedCount: number }>;
  clearCoverCache: () => Promise<{ removed: number; protectedCount: number; totalSizeBytes: number }>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getDefaultBookcaseDir: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
