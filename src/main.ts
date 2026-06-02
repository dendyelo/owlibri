import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { detectActiveMirror } from './main/services/mirror-detector';
import { LibgenPlusAdapter } from './main/services/libgen-plus-adapter';
import { downloadFile } from './main/services/download';
import { getLocalBooks, addLocalBook, deleteLocalBook } from './main/services/library-db';
import type { Entry } from './main/services/entry';
import { parseHTML } from 'linkedom';
import { parseSizeToBytes } from './main/services/utilities';
import { getAppSettings, saveAppSettings, getDefaultBookcaseDir } from './main/services/settings-db';
import type { AppSettings } from './main/services/settings-db';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let activeMirror = 'https://libgen.li/';
let isConnected = false;
const activeAbortControllers = new Map<string, AbortController>();
const SEARCH_TIMEOUT_MS = 10000;
const DETAIL_TIMEOUT_MS = 10000;
const UPDATE_TIMEOUT_MS = 5000;

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isDownloadEntry = (entry: unknown): entry is Entry => {
  if (!isRecord(entry)) {
    return false;
  }

  return ['id', 'title', 'authors', 'size', 'extension', 'mirror'].every(
    (key) => typeof entry[key] === 'string',
  );
};

const createRequestSignal = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
};

const isAbortError = (error: unknown) => {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.message === 'Download was cancelled by user.'
  );
};

const isKnownBookPath = (filePath: string) => {
  const requestedPath = path.resolve(filePath);
  return getLocalBooks().some((book) => path.resolve(book.filePath) === requestedPath);
};

const getSafeExternalUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    title: 'owlibri v' + app.getVersion(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools (can be commented out for production release).
  // mainWindow.webContents.openDevTools();
};

app.on('ready', async () => {
  // Ensure bookcase folder exists based on settings
  const settings = getAppSettings();
  const bookcaseDir = settings.bookcaseDir;
  if (!fs.existsSync(bookcaseDir)) {
    try {
      fs.mkdirSync(bookcaseDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create bookcase directory on startup:', err);
    }
  }

  createWindow();

  // Set Dock icon on macOS during development/runtime
  if (process.platform === 'darwin') {
    const iconPath = path.join(app.getAppPath(), 'src', 'assets', 'icon.png');
    if (fs.existsSync(iconPath)) {
      try {
        const image = nativeImage.createFromPath(iconPath);
        app.dock.setIcon(image);
      } catch (err) {
        console.error('Failed to set Dock icon:', err);
      }
    }
  }
  // Detect active mirror asynchronously at startup
  activeMirror = await detectActiveMirror();
  console.log('Using active LibGen mirror:', activeMirror);

  // Verify if the active mirror is reachable
  try {
    const testRes = await fetch(activeMirror, { signal: AbortSignal.timeout(3000) });
    isConnected = testRes.ok;
  } catch {
    isConnected = false;
  }
  console.log('Mirror connection status:', isConnected ? 'Connected' : 'Disconnected');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mirror-status-changed', { url: activeMirror, connected: isConnected });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handler: Search LibGen
ipcMain.handle('search-libgen', async (_event, query: string) => {
  try {
    if (typeof query !== 'string') {
      return [];
    }

    if (!query.trim()) {
      return [];
    }

    const adapter = new LibgenPlusAdapter(activeMirror);
    const searchUrl = adapter.getSearchURL(query, 1, 25);
    
    const response = await fetch(searchUrl, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }
    const htmlText = await response.text();
    const { document } = parseHTML(htmlText);
    
    const entries = adapter.parseEntries(document as unknown as Document);
    
    // Resolve absolute cover image URLs
    entries.forEach(entry => {
      if (entry.coverUrl) {
        entry.coverUrl = new URL(entry.coverUrl, activeMirror).toString();
      }
    });
    
    return entries;
  } catch (error) {
    console.error('LibGen Search Error:', error);
    return [];
  }
});

// Helper to extract MD5
const getMd5FromMirror = (mirror: string): string => {
  const query = mirror.split('?')[1] || '';
  const params = new URLSearchParams(query);
  return params.get('md5') || '';
};

// IPC Handler: Download Book
ipcMain.handle('download-book', async (event, entry: Entry) => {
  if (!isDownloadEntry(entry)) {
    return { success: false, error: 'Invalid download entry.' };
  }

  if (activeAbortControllers.has(entry.id)) {
    return { success: false, error: 'Download is already active.' };
  }

  const controller = new AbortController();
  activeAbortControllers.set(entry.id, controller);

  try {
    const adapter = new LibgenPlusAdapter(activeMirror);
    let downloadUrl: string | undefined = undefined;

    // 1. Try fast API first
    if (entry.dbId) {
      const fastUrl = `https://libgen.download/api/download?id=${entry.dbId}`;
      try {
        const checkFast = await fetch(fastUrl, {
          signal: createRequestSignal(controller.signal, 3000),
        });
        if (checkFast.ok) {
          downloadUrl = fastUrl;
        }
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        // ignore and fallback
      }
    }

    // 2. Fallback to standard LibGen details page scraping
    if (!downloadUrl) {
      const md5 = getMd5FromMirror(entry.mirror);
      if (md5) {
        const detailUrl = adapter.getDetailPageURL(md5);
        const detailRes = await fetch(detailUrl, {
          signal: createRequestSignal(controller.signal, DETAIL_TIMEOUT_MS),
        });
        if (!detailRes.ok) {
          throw new Error(`Detail page request failed: ${detailRes.status} ${detailRes.statusText}`);
        }
        const detailHtml = await detailRes.text();
        const { document } = parseHTML(detailHtml);
        downloadUrl = adapter.getMainDownloadURLFromDocument(document as unknown as Document);
      }
    }

    if (!downloadUrl) {
      throw new Error('Download URL could not be resolved from any source.');
    }

    let progressBytes = 0;
    const downloadStartedAt = Date.now();
    let lastProgressAt = downloadStartedAt;
    let smoothedSpeed = 0;

    const settings = getAppSettings();
    const bookcaseDir = settings.bookcaseDir;

    const result = await downloadFile({
      downloadUrl,
      estimatedTotalBytes: parseSizeToBytes(entry.size),
      downloadDir: bookcaseDir,
      signal: controller.signal,
      onStart: (filename, total) => {
        lastProgressAt = Date.now();
        smoothedSpeed = 0;
        event.sender.send('download-progress', {
          id: entry.id,
          status: 'downloading',
          filename,
          total,
          progress: 0,
          speed: 0,
        });
      },
      onData: (filename, chunkLength, total) => {
        progressBytes += chunkLength;
        const now = Date.now();
        const elapsedMs = now - lastProgressAt;
        if (elapsedMs > 0) {
          const instantaneousSpeed = (chunkLength * 1000) / elapsedMs;
          smoothedSpeed = smoothedSpeed === 0
            ? instantaneousSpeed
            : (smoothedSpeed * 0.8) + (instantaneousSpeed * 0.2);
        } else if (progressBytes > 0) {
          const elapsedFromStart = now - downloadStartedAt;
          smoothedSpeed = elapsedFromStart > 0 ? (progressBytes * 1000) / elapsedFromStart : 0;
        }
        lastProgressAt = now;
        event.sender.send('download-progress', {
          id: entry.id,
          status: 'downloading',
          filename,
          total,
          progress: progressBytes,
          speed: smoothedSpeed,
        });
      },
    });

    // Save to local library DB
    addLocalBook({
      id: entry.id,
      title: entry.title,
      authors: entry.authors,
      filePath: result.path,
      addedAt: new Date().toISOString(),
      format: entry.extension,
      size: entry.size,
      coverUrl: entry.coverUrl,
    });

    event.sender.send('download-complete', {
      id: entry.id,
      total: result.total,
      books: getLocalBooks(),
    });

    return { success: true, path: result.path };
  } catch (error) {
    const isCancelled = controller.signal.aborted || isAbortError(error);
    if (isCancelled) {
      console.log(`Download for book ${entry.id} was cancelled by user.`);
      event.sender.send('download-progress', {
        id: entry.id,
        status: 'cancelled',
        progress: 0,
        total: 0,
        speed: 0,
      });
    } else {
      console.error('Download Book Error:', error);
      event.sender.send('download-error', {
        id: entry.id,
        error: (error as Error).message,
      });
    }
    return { success: false, error: (error as Error).message };
  } finally {
    activeAbortControllers.delete(entry.id);
  }
});

// IPC Handler: Get Local Books (Bookcase)
ipcMain.handle('get-local-books', () => {
  return getLocalBooks();
});

// IPC Handler: Get Mirror Status
ipcMain.handle('get-mirror-status', () => {
  return { url: activeMirror, connected: isConnected };
});

// IPC Handler: Delete Local Book
ipcMain.handle('delete-book', async (_event, id: string) => {
  try {
    return deleteLocalBook(id);
  } catch (error) {
    console.error('Delete Book Error:', error);
    return getLocalBooks();
  }
});

// IPC Handler: Cancel Active Download
ipcMain.handle('cancel-download', async (_event, id: string) => {
  try {
    const controller = activeAbortControllers.get(id);
    if (controller) {
      controller.abort();
    }
    return { success: true };
  } catch (error) {
    console.error('Cancel Download Error:', error);
    return { success: false, error: (error as Error).message };
  }
});

// IPC Handler: Open Book with OS default viewer
ipcMain.handle('open-book', async (_event, filePath: string) => {
  try {
    if (typeof filePath !== 'string') {
      return { success: false, error: 'Invalid book path.' };
    }

    if (!isKnownBookPath(filePath)) {
      return { success: false, error: 'Book path is not registered in the local library.' };
    }

    const error = await shell.openPath(filePath);
    if (error) {
      return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// IPC Handler: Check For Updates from GitHub Releases
ipcMain.handle('check-for-updates', async () => {
  try {
    const response = await fetch('https://api.github.com/repos/dendyelo/owlibri/releases/latest', {
      headers: {
        'User-Agent': 'owlibri-app',
      },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    });
    if (!response.ok) return { updateAvailable: false };
    const data = (await response.json()) as GitHubRelease;
    const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, '') : '';
    const currentVersion = app.getVersion();

    // Simple semver comparison (major.minor.patch)
    const compareVersions = (v1: string, v2: string) => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
      }
      return 0;
    };

    if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
      return {
        updateAvailable: true,
        latestVersion: data.tag_name,
        currentVersion: `v${currentVersion}`,
        releaseUrl: data.html_url,
      };
    }
    return { updateAvailable: false };
  } catch (error) {
    console.error('Update Check Error:', error);
    return { updateAvailable: false };
  }
});

// IPC Handler: Open External URL in Default Web Browser
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    if (typeof url !== 'string') {
      return { success: false, error: 'Invalid external URL.' };
    }

    const safeUrl = getSafeExternalUrl(url);
    if (!safeUrl) {
      return { success: false, error: 'External URL is not allowed.' };
    }

    await shell.openExternal(safeUrl);
    return { success: true };
  } catch (error) {
    console.error('Open External Error:', error);
    return { success: false, error: (error as Error).message };
  }
});

// IPC Handler: Get Settings
ipcMain.handle('get-settings', () => {
  return getAppSettings();
});

// IPC Handler: Save Settings
ipcMain.handle('save-settings', (_event, settings: Partial<AppSettings>) => {
  return saveAppSettings(settings);
});

// IPC Handler: Get Default Bookcase Directory
ipcMain.handle('get-default-bookcase-dir', () => {
  return getDefaultBookcaseDir();
});

// IPC Handler: Open Folder Picker Dialog
ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});
