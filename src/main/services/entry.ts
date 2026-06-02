export interface Entry {
  id: string;
  dbId?: string;
  authors: string;
  title: string;
  publisher: string;
  year: string;
  pages: string;
  language: string;
  size: string;
  extension: string;
  mirror: string;
  coverUrl?: string;
}

const normalizeKeyPart = (value: string | undefined) => {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
};

export const getMd5FromEntryMirror = (mirror: string): string => {
  try {
    const query = mirror.split("?")[1] || "";
    const params = new URLSearchParams(query);
    return (params.get("md5") || "").toLowerCase();
  } catch {
    return "";
  }
};

export const getEntrySourceKey = (entry: Entry): string => {
  if (entry.dbId?.trim()) {
    return `db:${entry.dbId.trim()}`;
  }

  const md5 = getMd5FromEntryMirror(entry.mirror);
  if (md5) {
    return `md5:${md5}`;
  }

  return [
    "meta",
    normalizeKeyPart(entry.title),
    normalizeKeyPart(entry.authors),
    normalizeKeyPart(entry.extension),
    normalizeKeyPart(entry.year),
    normalizeKeyPart(entry.size),
  ].join(":");
};
