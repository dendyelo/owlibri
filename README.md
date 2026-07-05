# owlibri 🦉

<p align="center">
  <img src="assets/owlibri_1.png" alt="owlibri bookcase view" width="700" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-42.3.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19.2.7-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.4.21-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License" />
</p>

`owlibri` is a lightweight, elegant Electron desktop application designed for searching LibGen mirrors, downloading PDF and EPUB books, and organizing your digital library into a local, glassmorphic bookcase. If you need a clean workflow for downloading and reading academic papers, textbooks, and novels, `owlibri` is built for you.

---

## Table of Contents

1. [Key Features](#key-features)
2. [Screenshots](#screenshots)
3. [Tech Stack](#tech-stack)
4. [How to Install (Releases)](#how-to-install-releases)
5. [Local Development Guide](#local-development-guide)
6. [Update Behavior](#update-behavior)
7. [File Storage & Database](#file-storage--database)
8. [License](#license)

---

## Key Features

* **Interactive Glassmorphic Bookcase**: Browse and manage your local downloaded library in a modern card grid. Double-click any book card or click "Read" to open the file instantly in your system's default PDF/EPUB viewer.
* **Direct LibGen Search & Auto-Detection**: Search millions of books, papers, and textbooks. The app dynamically tests and routes requests through the fastest, active, online LibGen mirror.
* **Search Filters & Pagination**: Filter results by file type (PDF/EPUB) and language, sort by year, and page through search results (25 results per page).
* **Cover Art Resolution**: Automatically parses book metadata (database IDs and MD5s) to fetch cover previews dynamically, falling back to a custom card layout if not found.
* **Advanced Download Manager**:
  * Optimized download streams for fast, stable transfers.
  * Real-time indicators showing progress bar, file size, download speed, and ETA.
  * Native download cancellation support (aborts network requests and cleans up partial temporary files from your disk).
  * Reopen completed downloads directly from your history log.
* **Download History**: Keep track of all completed, cancelled, or failed downloads locally, and retry them with ease.
* **Customizable Settings**:
  * Choose between light and dark modes with a simple toggle.
  * Customize your default storage directory path (defaults to `Documents/owlibri/bookcase/`).

---

## Screenshots

<p align="center">
  <img src="assets/owlibri_2.png" alt="owlibri search view" width="700" />
</p>

---

## Tech Stack

* **Runtime:** [Electron](https://www.electronjs.org/) (Desktop environment)
* **Build System:** [Electron Forge](https://www.electronforge.io/) with [Vite](https://vitejs.dev/)
* **Frontend:** [React 19](https://react.dev/) & [TypeScript](https://www.typescriptlang.org/)
* **Styling:** Custom Glassmorphic theme using Vanilla CSS
* **HTML Parser:** [Linkedom](https://github.com/WebReflection/linkedom) (highly optimized XML/HTML parsing)

---

## How to Install (Releases)

1. Go to the [Releases](https://github.com/dendyelo/owlibri/releases) page on this repository.
2. Download the installer file corresponding to your operating system:
   * **macOS**: Download the `.dmg` disk image and drag the application into your `Applications` folder.
   * **Windows**: Download the `.exe` installer and follow the setup wizard.
   * **Linux**: Download the `.deb` or `.rpm` package and install it via your system package manager.
3. Open the app, search for your favorite books, and start building your bookcase.

---

## Local Development Guide

To run or build `owlibri` from source on your local machine, follow these steps.

### Prerequisites

Ensure you have the following installed:
* [Node.js](https://nodejs.org/) (version 18 or newer recommended)
* npm (bundled with Node) or another package manager (yarn, pnpm)

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/dendyelo/owlibri.git
   cd owlibri
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run in Development Mode:**
   Launch the Electron window and hot-reload CSS/JS changes:
   ```bash
   npm start
   ```

### Packaging & Compiling

* **To package the app** (packages the app into folder structures without creating an installer):
  ```bash
  npm run package
  ```

* **To compile and build distribution packages** (creates `.dmg`, `.exe`, `.deb`, etc. based on your host OS):
  ```bash
  npm run make
  ```

---

## Update Behavior

* **Windows**: Stable releases check, download, and apply updates automatically from GitHub Releases, then prompt you to restart.
* **macOS**: Manual updates. Download the newest `.dmg` from the GitHub Releases page and overwrite the app in `Applications`.
* **Linux**: Manual updates. Download the latest `.deb` or `.rpm` package from the Releases page and reinstall.

---

## File Storage & Database

All book database records and downloaded files are kept strictly local to your machine:
* **Default Storage Directory**: `Documents/owlibri/bookcase/` (can be changed in the application's settings).
* **Application Settings & Database**: Kept inside Electron's standard user-data directory (e.g. `~/Library/Application Support/owlibri/` on macOS).

---

## License

This application is distributed under the MIT License. See [LICENSE](LICENSE) for more details.
