import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { detectActiveMirror } from './main/services/mirror-detector';
import { LibgenPlusAdapter } from './main/services/libgen-plus-adapter';
import { downloadFile } from './main/services/download';
import { getLocalBooks, addLocalBook, deleteLocalBook } from './main/services/library-db';
import { getEntrySourceKey, getMd5FromEntryMirror } from './main/services/entry';
import type { Entry } from './main/services/entry';
import { parseHTML } from 'linkedom';
import { parseSizeToBytes } from './main/services/utilities';
import { getAppSettings, saveAppSettings, getDefaultBookcaseDir } from './main/services/settings-db';
import type { AppSettings } from './main/services/settings-db';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import { clearCoverCache, cleanupExpiredCoverCache, getCoverCacheStats, resolveCoverImage } from './main/services/cover-cache';
import { clearDownloadHistory, deleteDownloadHistory, getDownloadHistory, upsertDownloadHistory } from './main/services/download-history';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let activeMirror = 'https://libgen.li/';
let isConnected = false;
const activeAbortControllers = new Map<string, AbortController>();
const SEARCH_TIMEOUT_MS = 25000;
const DETAIL_TIMEOUT_MS = 10000;
const UPDATE_TIMEOUT_MS = 5000;
const DEFAULT_LIBGEN_MIRROR = 'https://libgen.li/';

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

interface SearchResultPayload {
  success: boolean;
  entries: Entry[];
  error?: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const parseVersion = (version: string): ParsedVersion => {
  const normalized = version.replace(/^v/, "");
  const [coreVersion, prereleasePart = ""] = normalized.split("-", 2);
  const [major = "0", minor = "0", patch = "0"] = coreVersion.split(".");

  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
    prerelease: prereleasePart ? prereleasePart.split(".").filter(Boolean) : [],
  };
};

const comparePrereleaseIdentifiers = (left: string, right: string) => {
  const leftIsNumber = /^\d+$/.test(left);
  const rightIsNumber = /^\d+$/.test(right);

  if (leftIsNumber && rightIsNumber) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10);
  }

  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;

  return left.localeCompare(right);
};

const compareVersions = (leftVersion: string, rightVersion: string) => {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;

  if (!leftHasPrerelease && rightHasPrerelease) return 1;
  if (leftHasPrerelease && !rightHasPrerelease) return -1;
  if (!leftHasPrerelease && !rightHasPrerelease) return 0;

  const sharedLength = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = comparePrereleaseIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.prerelease.length - right.prerelease.length;
};

const isPrereleaseBuild = () => {
  return parseVersion(app.getVersion()).prerelease.length > 0;
};

const getUpdateChannel = () => {
  return isPrereleaseBuild() ? 'pre' : 'stable';
};

const fetchGitHubReleases = async () => {
  const response = await fetch('https://api.github.com/repos/dendyelo/owlibri/releases?per_page=50', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'owlibri-app',
    },
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((release) => release as GitHubRelease)
    .filter((release) => typeof release.tag_name === 'string' && release.tag_name.trim());
};

const getLatestReleaseForChannel = async (channel: 'stable' | 'pre') => {
  const releases = await fetchGitHubReleases();
  const candidates = releases.filter((release) => {
    if (release.draft) {
      return false;
    }

    return channel === 'pre' ? true : !release.prerelease;
  });

  candidates.sort((left, right) => {
    const leftTag = left.tag_name || '';
    const rightTag = right.tag_name || '';
    return compareVersions(rightTag, leftTag);
  });

  return candidates[0] || null;
};

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

const isTimeoutLikeError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const name = 'name' in error ? String((error as { name?: unknown }).name || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  return name === 'TimeoutError' || name === 'AbortError' || message.toLowerCase().includes('timeout');
};

const isKnownBookPath = (filePath: string) => {
  const requestedPath = path.resolve(filePath);
  return getLocalBooks().some((book) => path.resolve(book.filePath) === requestedPath);
};

const isKnownDownloadPath = (filePath: string) => {
  const requestedPath = path.resolve(filePath);
  return getDownloadHistory().some((item) => (
    item.status === 'completed' &&
    typeof item.filePath === 'string' &&
    path.resolve(item.filePath) === requestedPath
  ));
};

const getProtectedCoverUrls = () => {
  return getLocalBooks()
    .map((book) => book.coverUrl)
    .filter((coverUrl): coverUrl is string => typeof coverUrl === 'string' && coverUrl.trim().length > 0);
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

const searchEntriesOnMirror = async (query: string, mirror: string): Promise<Entry[]> => {
  const adapter = new LibgenPlusAdapter(mirror);
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

  entries.forEach((entry) => {
    if (entry.coverUrl) {
      entry.coverUrl = new URL(entry.coverUrl, mirror).toString();
    }
  });

  return entries;
};

const getSearchErrorMessage = (error: unknown) => {
  if (isTimeoutLikeError(error)) {
    return 'Search timed out while contacting LibGen. The mirror may be busy. Please try again.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Search failed. Please try again.';
};

const initializeWindowsAutoUpdate = () => {
  if (
    process.platform !== 'win32' ||
    !app.isPackaged ||
    process.argv.includes('--squirrel-firstrun') ||
    isPrereleaseBuild()
  ) {
    return;
  }

  setTimeout(() => {
    try {
      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.ElectronPublicUpdateService,
          repo: 'dendyelo/owlibri',
        },
      });
    } catch (error) {
      console.error('Failed to initialize Windows auto-update:', error);
    }
  }, 10000);
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

  initializeWindowsAutoUpdate();
  createWindow();

  setTimeout(() => {
    try {
      const cacheCleanupResult = cleanupExpiredCoverCache(getProtectedCoverUrls());
      if (cacheCleanupResult.removed > 0) {
        console.log(
          `Pruned ${cacheCleanupResult.removed} expired cover cache file(s) on startup.`,
        );
      }
    } catch (error) {
      console.error('Failed to clean up cover cache:', error);
    }
  }, 5000);

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
ipcMain.handle('search-libgen', async (_event, query: string): Promise<SearchResultPayload> => {
  try {
    if (typeof query !== 'string') {
      return { success: true, entries: [] };
    }

    if (!query.trim()) {
      return { success: true, entries: [] };
    }

    const mirrors = Array.from(new Set([activeMirror, DEFAULT_LIBGEN_MIRROR]));
    let lastError: unknown = null;
    let hadSuccessfulResponse = false;

    for (const mirror of mirrors) {
      try {
        const entries = await searchEntriesOnMirror(query, mirror);
        if (entries.length > 0) {
          return { success: true, entries };
        }
        hadSuccessfulResponse = true;
      } catch (error) {
        lastError = error;
        console.error(`LibGen search attempt failed for ${mirror}:`, error);
        if (!isTimeoutLikeError(error)) {
          continue;
        }
      }
    }

    if (lastError && !hadSuccessfulResponse) {
      return {
        success: false,
        entries: [],
        error: getSearchErrorMessage(lastError),
      };
    }

    return { success: true, entries: [] };
  } catch (error) {
    console.error('LibGen Search Error:', error);
    return {
      success: false,
      entries: [],
      error: getSearchErrorMessage(error),
    };
  }
});

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
  let progressBytes = 0;
  const downloadStartedAt = Date.now();
  let lastProgressAt = downloadStartedAt;
  let smoothedSpeed = 0;

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
      const md5 = getMd5FromEntryMirror(entry.mirror);
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

    // Warm the cover cache without storing large data URLs in the library DB.
    await resolveCoverImage(entry.coverUrl);
    const completedAt = new Date().toISOString();
    const sourceKey = getEntrySourceKey(entry);
    addLocalBook({
      id: entry.id,
      sourceKey,
      dbId: entry.dbId,
      title: entry.title,
      authors: entry.authors,
      filePath: result.path,
      addedAt: new Date().toISOString(),
      format: entry.extension,
      size: entry.size,
      publisher: entry.publisher,
      year: entry.year,
      pages: entry.pages,
      language: entry.language,
      coverUrl: entry.coverUrl,
      sourceMirror: entry.mirror,
    });

    upsertDownloadHistory({
      id: entry.id,
      sourceKey,
      dbId: entry.dbId,
      title: entry.title,
      authors: entry.authors,
      publisher: entry.publisher,
      year: entry.year,
      pages: entry.pages,
      language: entry.language,
      format: entry.extension,
      size: entry.size,
      mirror: entry.mirror,
      coverUrl: entry.coverUrl,
      status: "completed",
      progress: result.total,
      total: result.total,
      speed: smoothedSpeed,
      filePath: result.path,
      filename: result.filename,
      addedAt: completedAt,
      updatedAt: completedAt,
      completedAt,
    });

    event.sender.send('download-complete', {
      id: entry.id,
      total: result.total,
      filePath: result.path,
      filename: result.filename,
      books: getLocalBooks(),
    });

    return { success: true, path: result.path };
  } catch (error) {
    const isCancelled = controller.signal.aborted || isAbortError(error);
    const fallbackTotal = parseSizeToBytes(entry.size);
    const historyTimestamp = new Date().toISOString();
    if (isCancelled) {
      console.log(`Download for book ${entry.id} was cancelled by user.`);
      upsertDownloadHistory({
        id: entry.id,
        sourceKey: getEntrySourceKey(entry),
        dbId: entry.dbId,
        title: entry.title,
        authors: entry.authors,
        publisher: entry.publisher,
        year: entry.year,
        pages: entry.pages,
        language: entry.language,
        format: entry.extension,
        size: entry.size,
        mirror: entry.mirror,
        coverUrl: entry.coverUrl,
        status: "cancelled",
        progress: progressBytes,
        total: fallbackTotal,
        speed: smoothedSpeed,
        addedAt: historyTimestamp,
        updatedAt: historyTimestamp,
      });
      event.sender.send('download-progress', {
        id: entry.id,
        status: 'cancelled',
        progress: progressBytes,
        total: fallbackTotal,
        speed: smoothedSpeed,
      });
    } else {
      console.error('Download Book Error:', error);
      upsertDownloadHistory({
        id: entry.id,
        sourceKey: getEntrySourceKey(entry),
        dbId: entry.dbId,
        title: entry.title,
        authors: entry.authors,
        publisher: entry.publisher,
        year: entry.year,
        pages: entry.pages,
        language: entry.language,
        format: entry.extension,
        size: entry.size,
        mirror: entry.mirror,
        coverUrl: entry.coverUrl,
        status: "error",
        progress: progressBytes,
        total: fallbackTotal,
        speed: smoothedSpeed,
        error: (error as Error).message,
        addedAt: historyTimestamp,
        updatedAt: historyTimestamp,
      });
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

// IPC Handler: Get Download History
ipcMain.handle('get-download-history', () => {
  return getDownloadHistory();
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

// IPC Handler: Delete Download History Entry
ipcMain.handle('delete-download-history', async (_event, id: string) => {
  try {
    return deleteDownloadHistory(id);
  } catch (error) {
    console.error('Delete Download History Error:', error);
    return getDownloadHistory();
  }
});

// IPC Handler: Clear Download History
ipcMain.handle('clear-download-history', async () => {
  try {
    return clearDownloadHistory();
  } catch (error) {
    console.error('Clear Download History Error:', error);
    return getDownloadHistory();
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

    if (!isKnownBookPath(filePath) && !isKnownDownloadPath(filePath)) {
      return { success: false, error: 'File path is not registered in the local library or download history.' };
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
    const channel = getUpdateChannel();
    if (process.platform === 'win32' && channel === 'stable') {
      return { updateAvailable: false };
    }

    const latestRelease = await getLatestReleaseForChannel(channel);
    if (!latestRelease?.tag_name) {
      return { updateAvailable: false };
    }

    const latestVersion = latestRelease.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
      return {
        updateAvailable: true,
        latestVersion: latestRelease.tag_name,
        currentVersion: `v${currentVersion}`,
        releaseUrl: latestRelease.html_url,
        channel: latestRelease.prerelease ? 'pre' : 'stable',
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

// IPC Handler: Resolve cover images through a cached local proxy file
ipcMain.handle('resolve-cover-image', async (_event, coverUrl: string) => {
  try {
    if (typeof coverUrl !== 'string' || !coverUrl.trim()) {
      return { success: false, error: 'Invalid cover URL.' };
    }

    const resolvedCoverUrl = await resolveCoverImage(coverUrl);
    if (!resolvedCoverUrl) {
      return { success: false, error: 'Cover image could not be resolved.' };
    }

    return { success: true, coverUrl: resolvedCoverUrl };
  } catch (error) {
    console.error('Resolve Cover Image Error:', error);
    return { success: false, error: (error as Error).message };
  }
});

// IPC Handler: Get cover cache statistics
ipcMain.handle('get-cover-cache-stats', () => {
  return getCoverCacheStats(getProtectedCoverUrls());
});

// IPC Handler: Clean expired cover cache files
ipcMain.handle('cleanup-cover-cache', () => {
  return cleanupExpiredCoverCache(getProtectedCoverUrls());
});

// IPC Handler: Clear cover cache
ipcMain.handle('clear-cover-cache', () => {
  return clearCoverCache(getProtectedCoverUrls());
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
