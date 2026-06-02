const CONFIG_URL =
  "https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json";

interface MirrorConfig {
  mirrors?: Array<{ src?: string }>;
}

export async function detectActiveMirror(): Promise<string> {
  try {
    const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as MirrorConfig;
    const mirrors = data.mirrors || [];
    
    for (const mirror of mirrors) {
      if (!mirror.src) {
        continue;
      }
      try {
        const testRes = await fetch(mirror.src, { signal: AbortSignal.timeout(3000) });
        if (testRes.ok) {
          return mirror.src;
        }
      } catch {
        // ignore and try next
      }
    }
  } catch {
    // ignore
  }
  
  // Fallback default
  return "https://libgen.li/";
}
