# owlibri 🦉

<p align="center">
  <img src="assets/owlibri_1.png" alt="owlibri bookcase view" />
</p>

Glassmorphic desktop bookcase and LibGen downloader.

`owlibri` is a lightweight Electron desktop app for searching LibGen mirrors, downloading PDF and EPUB books, and organizing digital books and scientific articles into a local glassmorphic bookcase. If you are looking for a `libgen downloader`, `ebook downloader`, or a local desktop book library, this project is built for that workflow.

---

## Key Features

* **Elegant Bookcase**: Browse and manage your local downloaded library in a visually stunning card grid.
* **Direct LibGen Search**: Search millions of books, papers, and textbooks directly from the application.
* **Search Filters & Pagination**: Filter results by file type and language, sort by year, and page through search results 25 at a time.
* **Cover Art Resolution**: Automatically parses and resolves book database IDs and MD5s to fetch cover previews dynamically.
* **Advanced Download Manager**:
  * Optimized download streams for fast and reliable file transfers.
  * Displays real-time download progress, file sizes, status indicators, live download speed, and ETA.
  * Native download cancellation support (instantly aborts network requests and cleans up partial temporary files from disk).
  * Completed downloads can be reopened later with **Open File** from download history.
* **Download History**: Track completed, cancelled, and failed downloads locally, then reopen or retry them later.
* **Theme Switch**: Toggle between light and dark themes in Settings.
* **System-Native Storage**: Saves all of your books in a dedicated, easy-to-access folder inside your user files: `Documents/owlibri/bookcase/`.
* **Instant Reader Launch**: Double-click any book card or click "Read" to open the file immediately inside your operating system's default PDF/EPUB viewer.

---

## Screenshots

<p align="center">
  <img src="assets/owlibri_2.png" alt="owlibri search view" />
</p>

## How to Install and Run

1. Go to the [Releases](https://github.com/dendyelo/owlibri/releases) page on this repository.
2. Download the appropriate file for your operating system:
   * **macOS**: Download the `.dmg` disk image and drag the app to your `Applications` folder.
   * **Windows**: Download the `.exe` installer and follow the quick setup wizard.
   * **Linux**: Download the `.deb` or `.rpm` package and install it via your package manager.
3. Open the application, head to the **Search LibGen** tab, find your books, and start building your bookcase.

---

## Update Behavior

* **Windows**: stable releases can download and apply updates automatically from GitHub Releases, then prompt you to restart.
* **macOS**: updates are manual. Download the newest `.dmg` from GitHub Releases and replace the app in `Applications`.
* **Linux**: updates are manual. Download the newest `.deb` or `.rpm` package from GitHub Releases and install it over the existing version.

---

## File Storage & Database

All book database entries and downloaded files are kept strictly local to your machine. You can find your physical documents here:
* **Storage Directory**: `Documents/owlibri/bookcase/`

---

## Search Terms

You can find this project on GitHub with terms like:

* `libgen`
* `libgen search`
* `libgen downloader`
* `ebook downloader`
* `pdf downloader`
* `epub downloader`
* `bookcase manager`
* `download history`
* `desktop bookcase`
* `electron book manager`
* `academic books`
* `academic papers`

---

## License

This application is distributed under the MIT License.
