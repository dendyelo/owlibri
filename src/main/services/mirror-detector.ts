const CONFIG_URL =
  "https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json";

interface MirrorConfig {
  mirrors?: Array<{ src?: string }>;
}

export const LIBGEN_FALLBACK_MIRRORS = [
  "https://libgen.li/",
  "https://libgen.la/",
  "https://libgen.gl/",
  "https://libgen.bz/",
  "https://libgen.vg/",
  "https://libgen.gs/",
  "https://libgen.lc/",
];

const normalizeMirrorUrl = (mirrorUrl: string) => {
  try {
    const normalized = new URL(mirrorUrl);
    if (normalized.protocol !== "https:" && normalized.protocol !== "http:") {
      return null;
    }
    normalized.protocol = "https:";
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
    const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(5000) });
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
        const testRes = await fetch(normalizedMirror, { signal: AbortSignal.timeout(3000) });
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
