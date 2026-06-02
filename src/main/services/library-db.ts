import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { readJsonFile, writeJsonFile } from "./json-store";

export interface LocalBook {
  id: string;
  sourceKey?: string;
  dbId?: string;
  title: string;
  authors: string;
  filePath: string;
  addedAt: string;
  format: string;
  size: string;
  publisher?: string;
  year?: string;
  pages?: string;
  language?: string;
  coverUrl?: string;
  sourceMirror?: string;
}

const getDbPath = () => {
  return path.join(app.getPath("userData"), "library.json");
};

export const getLocalBooks = (): LocalBook[] => {
  const data = readJsonFile<unknown>(getDbPath(), []);
  return Array.isArray(data) ? data.filter(isLocalBook) : [];
};

export const addLocalBook = (book: LocalBook) => {
  const books = getLocalBooks();
  
  // Prevent duplicate entries
  if (books.some(b => b.filePath === book.filePath)) {
    return;
  }
  
  books.push(book);
  writeJsonFile(getDbPath(), books);
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
  writeJsonFile(getDbPath(), updatedBooks);
  return updatedBooks;
};

const isLocalBook = (value: unknown): value is LocalBook => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const book = value as Partial<LocalBook>;
  return (
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.authors === "string" &&
    typeof book.filePath === "string" &&
    typeof book.addedAt === "string" &&
    typeof book.format === "string" &&
    typeof book.size === "string"
  );
};
