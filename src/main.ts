import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { detectActiveMirror } from './main/services/mirror-detector';
import { LibgenPlusAdapter } from './main/services/libgen-plus-adapter';
import { downloadFile } from './main/services/download';
import { getLocalBooks, addLocalBook, deleteLocalBook } from './main/services/library-db';
import { parseHTML } from 'linkedom';
import { parseSizeToBytes } from './main/services/utilities';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let activeMirror = 'https://libgen.li/';
let isConnected = false;
const activeAbortControllers = new Map<string, AbortController>();

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
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
  // Ensure Documents/owlibri/bookcase folder exists
  const bookcaseDir = path.join(app.getPath('documents'), 'owlibri', 'bookcase');
  if (!fs.existsSync(bookcaseDir)) {
    fs.mkdirSync(bookcaseDir, { recursive: true });
  }

  createWindow();
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
    const adapter = new LibgenPlusAdapter(activeMirror);
    const searchUrl = adapter.getSearchURL(query, 1, 25);
    
    const response = await fetch(searchUrl);
    const htmlText = await response.text();
    const { document } = parseHTML(htmlText);
    
    const entries = adapter.parseEntries(document as any);
    
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
ipcMain.handle('download-book', async (event, entry: any) => {
  try {
    const adapter = new LibgenPlusAdapter(activeMirror);
    let downloadUrl: string | undefined = undefined;

    // 1. Try fast API first
    if (entry.dbId) {
      const fastUrl = `https://libgen.download/api/download?id=${entry.dbId}`;
      try {
        const checkFast = await fetch(fastUrl, { signal: AbortSignal.timeout(3000) });
        if (checkFast.ok) {
          downloadUrl = fastUrl;
        }
      } catch {
        // ignore and fallback
      }
    }

    // 2. Fallback to standard LibGen details page scraping
    if (!downloadUrl) {
      const md5 = getMd5FromMirror(entry.mirror);
      if (md5) {
        const detailUrl = adapter.getDetailPageURL(md5);
        const detailRes = await fetch(detailUrl);
        const detailHtml = await detailRes.text();
        const { document } = parseHTML(detailHtml);
        downloadUrl = adapter.getMainDownloadURLFromDocument(document as any);
      }
    }

    if (!downloadUrl) {
      throw new Error('Download URL could not be resolved from any source.');
    }

    let progressBytes = 0;

    const bookcaseDir = path.join(app.getPath('documents'), 'owlibri', 'bookcase');
    const controller = new AbortController();
    activeAbortControllers.set(entry.id, controller);

    try {
      const result = await downloadFile({
        downloadUrl,
        estimatedTotalBytes: parseSizeToBytes(entry.size),
        downloadDir: bookcaseDir,
        signal: controller.signal,
        onStart: (filename, total) => {
          event.sender.send('download-progress', {
            id: entry.id,
            status: 'downloading',
            filename,
            total,
            progress: 0,
          });
        },
        onData: (filename, chunkLength, total) => {
          progressBytes += chunkLength;
          event.sender.send('download-progress', {
            id: entry.id,
            status: 'downloading',
            filename,
            total,
            progress: progressBytes,
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
        books: getLocalBooks(),
      });

      return { success: true, path: result.path };
    } finally {
      activeAbortControllers.delete(entry.id);
    }
  } catch (error) {
    const isCancelled = (error as Error).message === 'Download was cancelled by user.';
    if (isCancelled) {
      console.log(`Download for book ${entry.id} was cancelled by user.`);
      event.sender.send('download-progress', {
        id: entry.id,
        status: 'cancelled',
        progress: 0,
        total: 0,
      });
    } else {
      console.error('Download Book Error:', error);
      event.sender.send('download-error', {
        id: entry.id,
        error: (error as Error).message,
      });
    }
    return { success: false, error: (error as Error).message };
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
      activeAbortControllers.delete(id);
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
    const error = await shell.openPath(filePath);
    if (error) {
      return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});
