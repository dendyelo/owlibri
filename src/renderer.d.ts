import { Entry } from "./main/services/entry";
import { LocalBook } from "./main/services/library-db";

export interface DownloadProgress {
  id: string;
  status: 'downloading' | 'completed' | 'error';
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
  onDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void;
  onDownloadComplete: (callback: (data: DownloadComplete) => void) => () => void;
  onDownloadError: (callback: (data: DownloadError) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
