import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const COVER_FETCH_TIMEOUT_MS = 10_000;
const COVER_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const COVER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CACHEABLE_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

const coverUrlCache = new Map<string, string>();
const inFlightCoverResolutions = new Map<string, Promise<string | null>>();

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const getCoverCacheDir = () => {
  return path.join(app.getPath("userData"), "cover-cache");
};

const getFileExtensionFromContentType = (contentType: string) => {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
};

const getMimeTypeFromExtension = (extension: string) => {
  switch (extension.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
    default:
      return "image/jpeg";
  }
};

const toDataUrl = (mimeType: string, buffer: Buffer) => {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

const getSha1Hash = (value: string) => {
  return crypto.createHash("sha1").update(value).digest("hex");
};

const getCachePathForUrl = (coverUrl: string, extension: string) => {
  const hash = getSha1Hash(coverUrl);
  return path.join(getCoverCacheDir(), `${hash}.${extension}`);
};

const clearCoverCacheMemory = () => {
  coverUrlCache.clear();
  inFlightCoverResolutions.clear();
};

const refreshCacheFile = (filePath: string) => {
  try {
    const now = new Date();
    fs.utimesSync(filePath, now, now);
  } catch {
    // Ignore cache timestamp refresh failures.
  }
};

const findCachedCoverPath = (coverUrl: string) => {
  const hash = getSha1Hash(coverUrl);
  const cacheDir = getCoverCacheDir();
  for (const extension of CACHEABLE_IMAGE_EXTENSIONS) {
    const filePath = path.join(cacheDir, `${hash}.${extension}`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
};

export const getCoverCacheHashesForUrl = (coverUrl: string) => {
  if (!isHttpUrl(coverUrl)) {
    return [];
  }

  return buildCoverCandidates(coverUrl).map(getSha1Hash);
};

const buildProtectedCoverHashSet = (protectedCoverUrls: string[] = []) => {
  const protectedHashes = new Set<string>();

  for (const coverUrl of protectedCoverUrls) {
    for (const hash of getCoverCacheHashesForUrl(coverUrl)) {
      protectedHashes.add(hash);
    }
  }

  return protectedHashes;
};

export interface CoverCacheStats {
  fileCount: number;
  totalSizeBytes: number;
  protectedFileCount: number;
  removableExpiredFileCount: number;
}

export const getCoverCacheStats = (protectedCoverUrls: string[] = []): CoverCacheStats => {
  const cacheDir = getCoverCacheDir();
  if (!fs.existsSync(cacheDir)) {
    return { fileCount: 0, totalSizeBytes: 0, protectedFileCount: 0, removableExpiredFileCount: 0 };
  }

  const cutoffTime = Date.now() - COVER_CACHE_RETENTION_MS;
  let fileCount = 0;
  let totalSizeBytes = 0;
  let protectedFileCount = 0;
  let removableExpiredFileCount = 0;
  const protectedHashes = buildProtectedCoverHashSet(protectedCoverUrls);

  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(cacheDir, entry.name);
    const fileHash = path.parse(entry.name).name;
    try {
      const stats = fs.statSync(filePath);
      fileCount += 1;
      totalSizeBytes += stats.size;
      if (protectedHashes.has(fileHash)) {
        protectedFileCount += 1;
      } else if (stats.mtimeMs < cutoffTime) {
        removableExpiredFileCount += 1;
      }
    } catch {
      // Ignore files that disappear while collecting stats.
    }
  }

  return { fileCount, totalSizeBytes, protectedFileCount, removableExpiredFileCount };
};

export const cleanupExpiredCoverCache = (protectedCoverUrls: string[] = []) => {
  const cacheDir = getCoverCacheDir();
  if (!fs.existsSync(cacheDir)) {
    return { removed: 0, kept: 0, total: 0, protectedCount: 0 };
  }

  const cutoffTime = Date.now() - COVER_CACHE_RETENTION_MS;
  const protectedHashes = buildProtectedCoverHashSet(protectedCoverUrls);
  let removed = 0;
  let kept = 0;
  let total = 0;
  let protectedCount = 0;

  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    total += 1;
    const filePath = path.join(cacheDir, entry.name);
    const fileHash = path.parse(entry.name).name;

    try {
      const stats = fs.statSync(filePath);
      if (protectedHashes.has(fileHash)) {
        protectedCount += 1;
        kept += 1;
      } else if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filePath);
        removed += 1;
      } else {
        kept += 1;
      }
    } catch {
      // Ignore files that disappear during cleanup.
    }
  }

  if (removed > 0) {
    clearCoverCacheMemory();
  }

  return { removed, kept, total, protectedCount };
};

export const clearCoverCache = (protectedCoverUrls: string[] = []) => {
  const stats = getCoverCacheStats(protectedCoverUrls);
  const cacheDir = getCoverCacheDir();
  const protectedHashes = buildProtectedCoverHashSet(protectedCoverUrls);
  let removed = 0;
  let protectedCount = 0;
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(cacheDir, entry.name);
      const fileHash = path.parse(entry.name).name;

      if (protectedHashes.has(fileHash)) {
        protectedCount += 1;
        continue;
      }

      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch {
        // Ignore files that disappear during the clear operation.
      }
    }
  }
  clearCoverCacheMemory();

  return {
    removed,
    protectedCount: protectedCount || stats.protectedFileCount,
    totalSizeBytes: stats.totalSizeBytes,
  };
};

const buildCoverCandidates = (coverUrl: string) => {
  const candidates = new Set<string>();
  candidates.add(coverUrl);

  try {
    const parsedUrl = new URL(coverUrl);
    const variants = [".jpg", "_small.jpg", "-d.jpg"];
    for (const variant of variants) {
      const variantUrl = new URL(parsedUrl.pathname.replace(/(\.jpg|_small\.jpg|-d\.jpg)$/i, variant), parsedUrl);
      candidates.add(variantUrl.toString());
    }
  } catch {
    // Ignore malformed URLs. The caller will handle the failure.
  }

  return [...candidates];
};

const fetchAndCacheCover = async (coverUrl: string) => {
  const parsedUrl = new URL(coverUrl);
  const response = await fetch(coverUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: `${parsedUrl.origin}/`,
      "User-Agent": COVER_USER_AGENT,
    },
    signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("image")) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    return null;
  }

  const extension = getFileExtensionFromContentType(contentType);
  const cacheDir = getCoverCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachePath = getCachePathForUrl(coverUrl, extension);
  fs.writeFileSync(cachePath, buffer);

  return toDataUrl(contentType.includes("image/") ? contentType : getMimeTypeFromExtension(extension), buffer);
};

export const resolveCoverImage = async (coverUrl: string | undefined | null): Promise<string | null> => {
  if (!coverUrl) {
    return null;
  }

  if (coverUrl.startsWith("data:") || coverUrl.startsWith("file:")) {
    return coverUrl;
  }

  if (!isHttpUrl(coverUrl)) {
    if (path.isAbsolute(coverUrl) && fs.existsSync(coverUrl)) {
      const localBuffer = fs.readFileSync(coverUrl);
      const localExtension = path.extname(coverUrl).replace(/^\./, "") || "jpg";
      return toDataUrl(getMimeTypeFromExtension(localExtension), localBuffer);
    }
    return null;
  }

  for (const candidateUrl of buildCoverCandidates(coverUrl)) {
    const cachedPath = findCachedCoverPath(candidateUrl);
    if (cachedPath) {
      const cachedExtension = path.extname(cachedPath).replace(/^\./, "") || "jpg";
      const cachedBuffer = fs.readFileSync(cachedPath);
      refreshCacheFile(cachedPath);
      const cachedDataUrl = toDataUrl(getMimeTypeFromExtension(cachedExtension), cachedBuffer);
      coverUrlCache.set(candidateUrl, cachedDataUrl);
      return cachedDataUrl;
    }

    const cachedUrl = coverUrlCache.get(candidateUrl);
    if (cachedUrl) {
      return cachedUrl;
    }

    const existingRequest = inFlightCoverResolutions.get(candidateUrl);
    if (existingRequest) {
      const result = await existingRequest;
      if (result) {
        return result;
      }
      continue;
    }

    const request = fetchAndCacheCover(candidateUrl);
    inFlightCoverResolutions.set(candidateUrl, request);

    try {
      const resolvedUrl = await request;
      if (resolvedUrl) {
        coverUrlCache.set(candidateUrl, resolvedUrl);
        return resolvedUrl;
      }
    } finally {
      inFlightCoverResolutions.delete(candidateUrl);
    }
  }

  return null;
};
