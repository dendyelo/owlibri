import React, { useState, useEffect, FormEvent } from "react";
import { Entry } from "./main/services/entry";
import { LocalBook } from "./main/services/library-db";
import { parseSizeToBytes } from "./main/services/utilities";
import logoImg from "./assets/icon.png";

interface DownloadItem {
  id: string;
  title: string;
  authors: string;
  format: string;
  size: string;
  status: "queued" | "downloading" | "completed" | "error" | "cancelled";
  progress: number;
  total: number;
  error?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"bookcase" | "search" | "downloads" | "settings">("bookcase");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [localBooks, setLocalBooks] = useState<LocalBook[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadItem>>({});
  const [bookcasePath, setBookcasePath] = useState("");
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<{ url: string; connected: boolean }>({
    url: "",
    connected: false,
  });
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable: boolean;
    latestVersion?: string;
    currentVersion?: string;
    releaseUrl?: string;
  } | null>(null);

  // Fetch local library books on mount and listen to download events
  useEffect(() => {
    // 1. Initial Load
    window.api.getLocalBooks().then((books) => {
      setLocalBooks(books);
    });

    window.api.getMirrorStatus().then((status) => {
      setMirrorStatus(status);
    });

    window.api.getSettings().then((settings) => {
      setBookcasePath(settings.bookcaseDir);
    });

    const unsubscribeMirror = window.api.onMirrorStatusChanged((status) => {
      setMirrorStatus(status);
    });

    window.api.checkForUpdates().then((info) => {
      if (info && info.updateAvailable) {
        setUpdateInfo(info);
      }
    });

    // 2. Download Event Listeners
    const unsubscribeProgress = window.api.onDownloadProgress((data) => {
      setDownloads((prev) => {
        const existing = prev[data.id];
        if (!existing) return prev;
        return {
          ...prev,
          [data.id]: {
            ...existing,
            status: data.status,
            progress: data.progress,
            total: data.total || existing.total,
          },
        };
      });
    });

    const unsubscribeComplete = window.api.onDownloadComplete((data) => {
      setDownloads((prev) => {
        const existing = prev[data.id];
        if (!existing) return prev;
        const bookSize = data.books.find((book) => book.id === data.id)?.size || existing.size;
        const total = data.total || existing.total || parseSizeToBytes(bookSize) || 1;
        return {
          ...prev,
          [data.id]: {
            ...existing,
            status: "completed",
            progress: total,
            total,
          },
        };
      });
      // Update local bookcase
      setLocalBooks(data.books);
    });

    const unsubscribeError = window.api.onDownloadError((data) => {
      setDownloads((prev) => {
        const existing = prev[data.id];
        if (!existing) return prev;
        return {
          ...prev,
          [data.id]: {
            ...existing,
            status: "error",
            error: data.error,
          },
        };
      });
    });

    return () => {
      unsubscribeProgress();
      unsubscribeComplete();
      unsubscribeError();
      unsubscribeMirror();
    };
  }, []);

  // Handle book search from LibGen
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await window.api.searchLibgen(searchQuery);
      setSearchResults(results);
    } catch (err) {
      console.error("Failed search:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // Trigger book download
  const handleDownload = async (entry: Entry) => {
    // Prevent duplicate download of the same ID if already queued/active
    if (downloads[entry.id] && (downloads[entry.id].status === "downloading" || downloads[entry.id].status === "queued")) {
      return;
    }

    // Add to UI download queue
    setDownloads((prev) => ({
      ...prev,
      [entry.id]: {
        id: entry.id,
        title: entry.title,
        authors: entry.authors,
        format: entry.extension,
        size: entry.size,
        status: "queued",
        progress: 0,
        total: 0,
      },
    }));

    // Auto navigate or alert
    setActiveTab("downloads");

    try {
      await window.api.downloadBook(entry);
    } catch (error) {
      console.error("Error launching download process:", error);
    }
  };

  // Open book in external OS viewer
  const handleOpenBook = async (filePath: string) => {
    const res = await window.api.openBook(filePath);
    if (!res.success) {
      alert(`Could not open book: ${res.error}`);
    }
  };

  // Delete book from database and disk
  const handleDeleteBook = async (id: string, title: string) => {
    const confirmDelete = window.confirm(`Are you sure you want to remove "${title}" from your library and delete its physical file?`);
    if (!confirmDelete) return;

    try {
      const updatedBooks = await window.api.deleteBook(id);
      setLocalBooks(updatedBooks);
    } catch (error) {
      console.error("Failed to delete book:", error);
      alert("Error deleting book: " + (error as Error).message);
    }
  };

  // Cancel active download
  const handleCancelDownload = async (id: string) => {
    const confirmCancel = window.confirm("Are you sure you want to cancel this active download?");
    if (!confirmCancel) return;

    try {
      await window.api.cancelDownload(id);
      // Update UI state to cancelled
      setDownloads((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return {
          ...prev,
          [id]: {
            ...existing,
            status: "cancelled",
            error: undefined,
          },
        };
      });
    } catch (error) {
      console.error("Failed to cancel download:", error);
    }
  };

  // Remove a completed/failed download from UI queue list
  const handleRemoveFromQueue = (id: string) => {
    setDownloads((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  // Helper to format bytes to human readable string
  const formatBytes = (bytes: number): string => {
    if (bytes === 0 || !bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Helper to check if a book is already downloaded
  const isBookInLibrary = (title: string, authors: string) => {
    return localBooks.some(
      (b) =>
        b.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        b.authors.toLowerCase().trim() === authors.toLowerCase().trim()
    );
  };

  // Helper to get local book path
  const getBookPathInLibrary = (title: string, authors: string) => {
    return localBooks.find(
      (b) =>
        b.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        b.authors.toLowerCase().trim() === authors.toLowerCase().trim()
    )?.filePath;
  };

  const handleChangeDirectory = async () => {
    const newPath = await window.api.selectDirectory();
    if (newPath) {
      const updated = await window.api.saveSettings({ bookcaseDir: newPath });
      setBookcasePath(updated.bookcaseDir);
      triggerSavedToast();
    }
  };

  const handleResetToDefault = async () => {
    const defaultPath = await window.api.getDefaultBookcaseDir();
    const updated = await window.api.saveSettings({ bookcaseDir: defaultPath });
    setBookcasePath(updated.bookcaseDir);
    triggerSavedToast();
  };

  const triggerSavedToast = () => {
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
  };

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="brand">
          <img src={logoImg} className="brand-logo" alt="Logo" />
          <div className="brand-text">
            <h1>owlibri</h1>
            <span className="subtitle">personal library</span>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === "bookcase" ? "active" : ""}`}
            onClick={() => setActiveTab("bookcase")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="nav-icon">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Bookcase
            {localBooks.length > 0 && <span className="badge">{localBooks.length}</span>}
          </button>

          <button
            className={`nav-item ${activeTab === "search" ? "active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="nav-icon">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Search LibGen
          </button>

          <button
            className={`nav-item ${activeTab === "downloads" ? "active" : ""}`}
            onClick={() => setActiveTab("downloads")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="nav-icon">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Downloads
            {Object.values(downloads).some((d) => d.status === "downloading" || d.status === "queued") && (
              <span className="badge badge-active">
                {Object.values(downloads).filter((d) => d.status === "downloading" || d.status === "queued").length}
              </span>
            )}
          </button>

          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="nav-icon">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="mirror-status">
            <span className={`pulse-dot ${mirrorStatus.connected ? "connected" : "disconnected"}`}></span>
            <span className="status-label">
              {mirrorStatus.connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {updateInfo && updateInfo.updateAvailable && (
          <div className="update-banner">
            <div className="update-banner-body">
              <span className="update-icon">🚀</span>
              <span className="update-message">
                New version <strong>{updateInfo.latestVersion}</strong> is available! (Current: {updateInfo.currentVersion})
              </span>
            </div>
            <div className="update-banner-actions">
              <button 
                className="btn btn-primary btn-sm btn-update"
                onClick={() => window.api.openExternal(updateInfo.releaseUrl || "")}
              >
                Download Update
              </button>
              <button 
                className="btn-close-banner"
                onClick={() => setUpdateInfo(null)}
                title="Dismiss"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Bookcase Tab */}
        {activeTab === "bookcase" && (
          <section className="tab-pane">
            <div className="pane-header">
              <h2>Bookcase</h2>
              <p>Double-click a book card or click "Read" to open it in your system's default viewer.</p>
            </div>

            {localBooks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <h3>Your bookcase is empty</h3>
                <p>Find your favorite textbooks, scientific articles, and novels on LibGen.</p>
                <button className="btn btn-primary" onClick={() => setActiveTab("search")}>
                  Search LibGen
                </button>
              </div>
            ) : (
              <div className="books-grid">
                {localBooks.map((book) => (
                  <div
                    key={book.id}
                    className="book-card"
                    onDoubleClick={() => handleOpenBook(book.filePath)}
                  >
                    <div className="book-card-cover">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="book-cover-image"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cover-icon fallback-icon">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                      <span className={`book-format-badge format-${book.format.toLowerCase()}`}>
                        {book.format.toUpperCase()}
                      </span>
                    </div>
                    <div className="book-card-details">
                      <h3 className="book-title" title={book.title}>
                        {book.title}
                      </h3>
                      <p className="book-author" title={book.authors}>
                        {book.authors || "Unknown Author"}
                      </p>
                       <div className="book-card-footer">
                        <span className="book-size">{book.size}</span>
                        <div className="book-card-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenBook(book.filePath);
                            }}
                          >
                            Read
                          </button>
                          <button
                            className="btn btn-danger-icon btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBook(book.id, book.title);
                            }}
                            title="Delete Book"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="delete-btn-icon">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Search Tab */}
        {activeTab === "search" && (
          <section className="tab-pane">
            <div className="pane-header">
              <h2>Search LibGen</h2>
              <p>Search over millions of academic books, textbooks, and general literature papers.</p>
            </div>

            <form onSubmit={handleSearch} className="search-form">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  placeholder="Enter book title, author name, ISBN, or publisher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => setSearchQuery("")}
                  >
                    &times;
                  </button>
                )}
              </div>
              <button type="submit" className="btn btn-primary" disabled={isSearching}>
                {isSearching ? (
                  <>
                    <span className="spinner"></span> Searching...
                  </>
                ) : (
                  "Search"
                )}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="search-results-meta">
                Found {searchResults.length} books for your query.
              </div>
            )}

            <div className="search-results-list">
              {isSearching ? (
                <div className="loading-state">
                  <span className="spinner spinner-large"></span>
                  <p>Aggregating mirror links and fetching matching entries...</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="search-empty-state">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="search-icon-large">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <p>Enter a query above to search for books online.</p>
                </div>
              ) : (
                searchResults.map((entry) => {
                  const inLibrary = isBookInLibrary(entry.title, entry.authors);
                  const localPath = getBookPathInLibrary(entry.title, entry.authors);
                  const activeDl = downloads[entry.id];

                  return (
                    <div key={entry.id} className="search-result-card">
                      <div className="result-cover-wrapper">
                        {entry.coverUrl ? (
                          <img
                            src={entry.coverUrl}
                            alt="Cover"
                            className="result-cover-image"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        <span className={`badge-format format-${entry.extension.toLowerCase()}`}>
                          {entry.extension.toUpperCase() || "PDF"}
                        </span>
                      </div>
                      <div className="result-info">
                        <h3 className="result-title">{entry.title}</h3>
                        <p className="result-author">{entry.authors}</p>
                        <div className="result-metadata">
                          {entry.publisher && (
                            <span className="meta-item" title="Publisher">
                              <strong>Publisher:</strong> {entry.publisher}
                            </span>
                          )}
                          {entry.year && (
                            <span className="meta-item">
                              <strong>Year:</strong> {entry.year}
                            </span>
                          )}
                          {entry.pages && (
                            <span className="meta-item">
                              <strong>Pages:</strong> {entry.pages}
                            </span>
                          )}
                          {entry.language && (
                            <span className="meta-item">
                              <strong>Language:</strong> {entry.language}
                            </span>
                          )}
                          <span className="meta-item">
                            <strong>Size:</strong> {entry.size}
                          </span>
                        </div>
                      </div>
                      <div className="result-action">
                        {inLibrary && localPath ? (
                          <button
                            className="btn btn-secondary btn-full"
                            onClick={() => handleOpenBook(localPath)}
                          >
                            Read Now
                          </button>
                        ) : activeDl?.status === "error" || activeDl?.status === "cancelled" ? (
                          <button
                            className="btn btn-primary btn-full"
                            onClick={() => handleDownload(entry)}
                          >
                            Retry Download
                          </button>
                        ) : activeDl ? (
                          <button
                            className="btn btn-primary btn-full"
                            disabled
                          >
                            {activeDl.status === "queued" && "Queued..."}
                            {activeDl.status === "downloading" && (
                              <>
                                Downloading (
                                {activeDl.total > 0
                                  ? Math.round((activeDl.progress / activeDl.total) * 100)
                                  : "?"}
                                %)
                              </>
                            )}
                            {activeDl.status === "completed" && "Completed"}
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-full"
                            onClick={() => handleDownload(entry)}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {/* Downloads Tab */}
        {activeTab === "downloads" && (
          <section className="tab-pane">
            <div className="pane-header">
              <h2>Download Queue</h2>
              <p>Monitor your active book downloads and review transaction histories.</p>
            </div>

            {Object.keys(downloads).length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-icon">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
                <h3>No downloads yet</h3>
                <p>Your search downloads will appear here in real-time.</p>
              </div>
            ) : (
              <div className="downloads-list">
                {Object.values(downloads)
                  .reverse() // New downloads at the top
                  .map((item) => {
                    const percent = item.total > 0
                      ? Math.min(100, Math.round((item.progress / item.total) * 100))
                      : 0;
                    return (
                      <div key={item.id} className="download-row">
                        <div className="download-info">
                          <div className="download-title-row">
                            <h3 className="download-title">{item.title}</h3>
                            <div className="download-title-actions">
                              <span className={`badge-format format-${item.format.toLowerCase()}`}>
                                {item.format.toUpperCase()}
                              </span>
                              {(item.status === "downloading" || item.status === "queued") ? (
                                <button
                                  className="btn-cancel-download"
                                  onClick={() => handleCancelDownload(item.id)}
                                  title="Cancel Download"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cancel-icon">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                </button>
                              ) : (
                                <button
                                  className="btn-remove-queue"
                                  onClick={() => handleRemoveFromQueue(item.id)}
                                  title="Remove from List"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cancel-icon">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="download-author">{item.authors}</p>
                          <div className="download-meta">
                            <span>{item.size}</span>
                            {item.status === "downloading" && (
                              <span>
                                {formatBytes(item.progress)} / {item.total > 0 ? formatBytes(item.total) : "unknown size"}
                              </span>
                            )}
                            <span className={`status-text status-${item.status}`}>
                              {item.status.toUpperCase()}
                            </span>
                          </div>
                        </div>

                        {(item.status === "downloading" || item.status === "queued") && (
                          <div className="download-progress-container">
                            <div className="progress-bar-track">
                              <div
                                className="progress-bar-fill"
                                style={{ width: `${item.status === "queued" ? 5 : percent}%` }}
                              ></div>
                            </div>
                            <span className="progress-percent">
                              {item.status === "queued" ? "Connecting..." : `${percent}%`}
                            </span>
                          </div>
                        )}

                        {item.status === "error" && (
                          <div className="download-error-msg">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="error-icon-small">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            Error: {item.error || "Connection timed out"}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <section className="tab-pane">
            <div className="pane-header">
              <h2>Settings</h2>
              <p>Configure your personal preferences for bookcase management and storage.</p>
            </div>

            <div className="settings-container">
              <div className="settings-card">
                <div className="settings-card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="settings-sec-icon">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <h3>Library Storage Location</h3>
                </div>
                <div className="settings-card-body">
                  <p className="settings-desc">
                    Choose the folder where newly downloaded PDF/EPUB books will be saved on your disk.
                  </p>
                  
                  <div className="settings-path-field">
                    <input 
                      type="text" 
                      value={bookcasePath} 
                      readOnly 
                      className="settings-path-input"
                      title="Current storage path"
                    />
                    <button 
                      className="btn btn-secondary"
                      onClick={handleChangeDirectory}
                    >
                      Browse...
                    </button>
                  </div>

                  <div className="settings-card-actions">
                    <button 
                      className="btn-text-link"
                      onClick={handleResetToDefault}
                    >
                      Reset to Default Directory
                    </button>
                  </div>
                </div>
              </div>

              {showSavedToast && (
                <div className="settings-toast">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="toast-icon">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Settings saved successfully!</span>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
