const CONFIG_URL =
  "https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json";

interface MirrorConfig {
  mirrors?: Array<{ src?: string }>;
}

export const LIBGEN_FALLBACK_MIRRORS = [
  "http://libgen.li/",
  "https://libgen.la/",
  "https://libgen.gl/",
  "https://libgen.bz/",
  "https://libgen.vg/",
];

const LIBGEN_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const normalizeMirrorUrl = (mirrorUrl: string) => {
  try {
    const normalized = new URL(mirrorUrl);
    if (normalized.protocol !== "https:" && normalized.protocol !== "http:") {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
};

const dedupeMirrors = (mirrors: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const mirror of mirrors) {
    if (!mirror) {
      continue;
    }

    if (seen.has(mirror)) {
      continue;
    }

    seen.add(mirror);
    result.push(mirror);
  }

  return result;
};

export const getLibgenMirrorCandidates = (preferredMirror?: string) => {
  return dedupeMirrors([
    normalizeMirrorUrl(preferredMirror || ""),
    ...LIBGEN_FALLBACK_MIRRORS.map((mirror) => normalizeMirrorUrl(mirror)),
  ]);
};

export async function detectActiveMirror(): Promise<string> {
  try {
    const res = await fetch(CONFIG_URL, {
      signal: AbortSignal.timeout(5000),
      headers: LIBGEN_BROWSER_HEADERS,
    });
    const data = (await res.json()) as MirrorConfig;
    const mirrors = data.mirrors || [];

    for (const mirror of mirrors) {
      if (!mirror.src) {
        continue;
      }
      const normalizedMirror = normalizeMirrorUrl(mirror.src);
      if (!normalizedMirror) {
        continue;
      }
      try {
        const testRes = await fetch(normalizedMirror, {
          signal: AbortSignal.timeout(3000),
          headers: LIBGEN_BROWSER_HEADERS,
        });
        if (testRes.ok) {
          return normalizedMirror;
        }
      } catch {
        // ignore and try next
      }
    }
  } catch {
    // ignore
  }

  // Fallback default
  return LIBGEN_FALLBACK_MIRRORS[0];
}
