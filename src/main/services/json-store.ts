import fs from "node:fs";
import path from "node:path";

const getBackupPath = (filePath: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.${timestamp}.bak`;
};

export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    try {
      fs.copyFileSync(filePath, getBackupPath(filePath));
    } catch (backupError) {
      console.error(`Failed to back up unreadable JSON file: ${filePath}`, backupError);
    }
    console.error(`Failed to read JSON file: ${filePath}`, error);
    return fallback;
  }
};

export const writeJsonFile = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath)) {
    try {
      JSON.parse(fs.readFileSync(filePath, "utf-8"));
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      fs.copyFileSync(filePath, getBackupPath(filePath));
    }
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
};
