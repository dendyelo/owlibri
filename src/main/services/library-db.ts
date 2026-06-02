import fs from "fs";
import path from "path";
import { app } from "electron";

export interface LocalBook {
  id: string;
  title: string;
  authors: string;
  filePath: string;
  addedAt: string;
  format: string;
  size: string;
  coverUrl?: string;
}

const getDbPath = () => {
  return path.join(app.getPath("userData"), "library.json");
};

export const getLocalBooks = (): LocalBook[] => {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(dbPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const addLocalBook = (book: LocalBook) => {
  const books = getLocalBooks();
  
  // Prevent duplicate entries
  if (books.some(b => b.filePath === book.filePath)) {
    return;
  }
  
  books.push(book);
  fs.writeFileSync(getDbPath(), JSON.stringify(books, null, 2), "utf-8");
};

export const deleteLocalBook = (id: string, deleteFile = true): LocalBook[] => {
  const books = getLocalBooks();
  const book = books.find(b => b.id === id);
  if (!book) return books;

  if (deleteFile && book.filePath) {
    try {
      if (fs.existsSync(book.filePath)) {
        fs.unlinkSync(book.filePath);
      }
    } catch (err) {
      console.error(`Failed to delete physical file: ${book.filePath}`, err);
    }
  }

  const updatedBooks = books.filter(b => b.id !== id);
  fs.writeFileSync(getDbPath(), JSON.stringify(updatedBooks, null, 2), "utf-8");
  return updatedBooks;
};
