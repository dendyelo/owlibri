import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type DownloadHistoryStatus = "completed" | "error" | "cancelled";

export interface DownloadHistoryItem {
  id: string;
  title: string;
  authors: string;
  format: string;
  size: string;
  status: DownloadHistoryStatus;
  progress: number;
  total: number;
  speed?: number;
  error?: string;
  filePath?: string;
  filename?: string;
  addedAt: string;
  updatedAt: string;
  completedAt?: string;
}

const getHistoryPath = () => {
  return path.join(app.getPath("userData"), "downloads.json");
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isValidStatus = (value: unknown): value is DownloadHistoryStatus => {
  return value === "completed" || value === "error" || value === "cancelled";
};

const toNumber = (value: unknown, fallback = 0) => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const toString = (value: unknown, fallback = "") => {
  return typeof value === "string" ? value : fallback;
};

const toOptionalString = (value: unknown) => {
  return typeof value === "string" && value.trim() ? value : undefined;
};

const readHistoryFile = (): unknown[] => {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeHistoryFile = (items: DownloadHistoryItem[]) => {
  const historyPath = getHistoryPath();
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(items, null, 2), "utf-8");
};

const normalizeHistoryItem = (item: unknown): DownloadHistoryItem | null => {
  if (!isRecord(item)) {
    return null;
  }

  const id = toString(item.id);
  const title = toString(item.title);
  const authors = toString(item.authors);
  const format = toString(item.format);
  const size = toString(item.size);
  const status = item.status;
  const addedAt = toString(item.addedAt);
  const updatedAt = toString(item.updatedAt);

  if (!id || !title || !authors || !format || !size || !isValidStatus(status) || !addedAt || !updatedAt) {
    return null;
  }

  const normalized: DownloadHistoryItem = {
    id,
    title,
    authors,
    format,
    size,
    status,
    progress: toNumber(item.progress),
    total: toNumber(item.total),
    speed: typeof item.speed === "number" ? item.speed : undefined,
    error: toOptionalString(item.error),
    filePath: toOptionalString(item.filePath),
    filename: toOptionalString(item.filename),
    addedAt,
    updatedAt,
    completedAt: toOptionalString(item.completedAt),
  };

  return normalized;
};

const sortHistory = (items: DownloadHistoryItem[]) => {
  return [...items].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
};

export const getDownloadHistory = (): DownloadHistoryItem[] => {
  return sortHistory(readHistoryFile().map(normalizeHistoryItem).filter((item): item is DownloadHistoryItem => Boolean(item)));
};

export const upsertDownloadHistory = (item: DownloadHistoryItem): DownloadHistoryItem[] => {
  const history = getDownloadHistory();
  const now = new Date().toISOString();
  const existingIndex = history.findIndex((entry) => entry.id === item.id);
  const existing = existingIndex >= 0 ? history[existingIndex] : null;

  const merged: DownloadHistoryItem = {
    ...(existing ?? {}),
    ...item,
    progress: typeof item.progress === "number" ? item.progress : existing?.progress ?? 0,
    total: typeof item.total === "number" ? item.total : existing?.total ?? 0,
    speed: typeof item.speed === "number" ? item.speed : existing?.speed,
    error: typeof item.error === "string" ? item.error : existing?.error,
    filePath: typeof item.filePath === "string" ? item.filePath : existing?.filePath,
    filename: typeof item.filename === "string" ? item.filename : existing?.filename,
    addedAt: existing?.addedAt ?? item.addedAt ?? now,
    updatedAt: now,
    completedAt: item.status === "completed" ? (item.completedAt ?? now) : existing?.completedAt,
  };

  if (existingIndex >= 0) {
    history.splice(existingIndex, 1);
  }

  history.unshift(merged);
  writeHistoryFile(history);
  return sortHistory(history);
};

export const deleteDownloadHistory = (id: string): DownloadHistoryItem[] => {
  const history = getDownloadHistory().filter((item) => item.id !== id);
  writeHistoryFile(history);
  return history;
};

export const clearDownloadHistory = (): DownloadHistoryItem[] => {
  const historyPath = getHistoryPath();
  if (fs.existsSync(historyPath)) {
    fs.unlinkSync(historyPath);
  }
  return [];
};
