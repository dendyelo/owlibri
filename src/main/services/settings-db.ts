import fs from "fs";
import path from "path";
import { app } from "electron";

export interface AppSettings {
  bookcaseDir: string;
}

const getSettingsPath = () => {
  return path.join(app.getPath("userData"), "settings.json");
};

export const getDefaultBookcaseDir = () => {
  return path.join(app.getPath("documents"), "owlibri", "bookcase");
};

export const getAppSettings = (): AppSettings => {
  const settingsPath = getSettingsPath();
  const defaultDir = getDefaultBookcaseDir();
  
  if (!fs.existsSync(settingsPath)) {
    return { bookcaseDir: defaultDir };
  }
  
  try {
    const data = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(data);
    return {
      bookcaseDir: settings.bookcaseDir || defaultDir
    };
  } catch {
    return { bookcaseDir: defaultDir };
  }
};

export const saveAppSettings = (settings: Partial<AppSettings>): AppSettings => {
  const current = getAppSettings();
  const updated = {
    ...current,
    ...(typeof settings.bookcaseDir === "string" ? { bookcaseDir: settings.bookcaseDir } : {}),
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
  
  fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
};
