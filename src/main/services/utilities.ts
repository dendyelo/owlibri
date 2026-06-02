export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function clearText(text: string): string {
  return text
    .split("\n")[0]
    .replaceAll(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .replaceAll(/<[^>]+>/g, "")
    .trim();
}

export function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.trim().match(/^(\d+(?:\.\d+)?)\s*([KMG]?B)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  switch (unit) {
    case "KB": return val * 1024;
    case "MB": return val * 1024 * 1024;
    case "GB": return val * 1024 * 1024 * 1024;
    default: return val;
  }
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const base = 1024;
  const unitIndex = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(base)), units.length - 1);
  const value = bytesPerSecond / Math.pow(base, unitIndex);

  return `${parseFloat(value.toFixed(value >= 10 ? 1 : 2))} ${units[unitIndex]}`;
}
