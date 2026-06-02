import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { readJsonFile, writeJsonFile } from "./json-store";

export type ThemeMode = "dark" | "light";

export interface AppSettings {
  bookcaseDir: string;
  theme: ThemeMode;
}

const getSettingsPath = () => {
  return path.join(app.getPath("userData"), "settings.json");
};

const DEFAULT_THEME: ThemeMode = "dark";

const isThemeMode = (value: unknown): value is ThemeMode => {
  return value === "dark" || value === "light";
};

export const getDefaultBookcaseDir = () => {
  return path.join(app.getPath("documents"), "owlibri", "bookcase");
};

export const getAppSettings = (): AppSettings => {
  const defaultDir = getDefaultBookcaseDir();
  const settings = readJsonFile<Partial<AppSettings>>(getSettingsPath(), {});
  return {
    bookcaseDir: typeof settings.bookcaseDir === "string" && settings.bookcaseDir.trim()
      ? settings.bookcaseDir
      : defaultDir,
    theme: isThemeMode(settings.theme) ? settings.theme : DEFAULT_THEME,
  };
};

export const saveAppSettings = (settings: Partial<AppSettings>): AppSettings => {
  const current = getAppSettings();
  const bookcaseDir = typeof settings.bookcaseDir === "string" && settings.bookcaseDir.trim()
    ? settings.bookcaseDir
    : undefined;
  const updated = {
    ...current,
    ...(bookcaseDir ? { bookcaseDir } : {}),
    ...(isThemeMode(settings.theme) ? { theme: settings.theme } : {}),
  };
  
  // Ensure the bookcaseDir exists when saving
  if (updated.bookcaseDir) {
    try {
      if (!fs.existsSync(updated.bookcaseDir)) {
        fs.mkdirSync(updated.bookcaseDir, { recursive: true });
      }
    } catch (err) {
      console.error("Failed to create settings bookcase directory:", err);
    }
  }
  
  writeJsonFile(getSettingsPath(), updated);
  return updated;
};
