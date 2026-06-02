const CONFIG_URL =
  "https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json";

export async function detectActiveMirror(): Promise<string> {
  try {
    const res = await fetch(CONFIG_URL);
    const data = (await res.json()) as any;
    const mirrors = data.mirrors || [];
    
    for (const mirror of mirrors) {
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
