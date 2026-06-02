import contentDisposition from "content-disposition";
import fs from "fs";
import path from "path";

interface downloadFileArguments {
  downloadUrl: string;
  estimatedTotalBytes?: number;
  downloadDir: string;
  signal?: AbortSignal;
  onStart: (filename: string, total: number) => void;
  onData: (filename: string, chunkLength: number, total: number) => void;
}

export interface DownloadResult {
  path: string;
  filename: string;
  total: number;
}

const getFallbackFilename = (downloadUrl: string): string => {
  try {
    const pathname = new URL(downloadUrl).pathname;
    return decodeURIComponent(path.basename(pathname)) || "downloaded-book";
  } catch {
    return "downloaded-book";
  }
};

const getUniqueFilePath = (downloadDir: string, filename: string): string => {
  const extension = path.extname(filename);
  const basename = path.basename(filename, extension);
  let candidate = path.join(downloadDir, filename);
  let suffix = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadDir, `${basename} (${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
};

const removePartialFile = (filePath: string, reason: string) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(`Failed to remove partial download after ${reason}:`, error);
  }
};

export const downloadFile = async ({
  downloadUrl,
  estimatedTotalBytes,
  downloadDir,
  signal,
  onStart,
  onData,
}: downloadFileArguments): Promise<DownloadResult> => {
  const MAX_FILE_NAME_LENGTH = 128;
  const MAX_RETRIES = 5;

  let retries = 0;
  let bytesDownloaded = 0;
  let fileTotalSize = 0;
  let filePath = "";
  let filename = "";

  while (retries < MAX_RETRIES) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      const fileExists = filePath && fs.existsSync(filePath);
      
      if (fileExists && bytesDownloaded > 0) {
        headers["Range"] = `bytes=${bytesDownloaded}-`;
      }

      const response = await fetch(downloadUrl, { headers, signal });
      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      if (retries === 0) {
        const downloadContentDisposition = response.headers.get("content-disposition");
        const parsedContentDisposition = downloadContentDisposition
          ? contentDisposition.parse(downloadContentDisposition)
          : null;
        const fullFileName =
          parsedContentDisposition?.parameters.filename || getFallbackFilename(downloadUrl);
        const sanitizedFileName = fullFileName.replace(/[/\\:*?"<>|]/g, "_");
        const slicedFileName = sanitizedFileName.slice(
          Math.max(sanitizedFileName.length - MAX_FILE_NAME_LENGTH, 0)
        );
        
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
        }
        filePath = getUniqueFilePath(downloadDir, slicedFileName);
        filename = path.basename(filePath);
        const contentLength = Number(response.headers.get("content-length") || 0);
        fileTotalSize = contentLength > 0 ? contentLength : (estimatedTotalBytes || 0);

        onStart(filename, fileTotalSize);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const isPartial = response.status === 206;
      const fileMode = isPartial ? "a" : "w";

      if (!isPartial) {
        bytesDownloaded = 0;
      }

      const file = fs.createWriteStream(filePath, { flags: fileMode });
      let writeError: Error | null = null;
      file.on("error", (err) => {
        writeError = err;
      });

      const reader = response.body.getReader();

      try {
        for (;;) {
          if (signal?.aborted) {
            throw new Error("Download was cancelled by user.");
          }
          if (writeError) {
            throw writeError;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = Buffer.from(value);
          const canWrite = file.write(chunk);
          if (!canWrite) {
            await new Promise<void>((resolve, reject) => {
              file.once("drain", resolve);
              file.once("error", reject);
            });
          }
          bytesDownloaded += chunk.length;
          onData(filename, chunk.length, fileTotalSize);
        }

        if (writeError) {
          throw writeError;
        }

        file.end();

        await new Promise<void>((resolve, reject) => {
          if (writeError) {
            return reject(writeError);
          }
          file.on("finish", resolve);
          file.on("error", reject);
        });

        return {
          path: filePath,
          filename,
          total: fileTotalSize,
        };
      } catch (streamError) {
        file.destroy();
        throw streamError;
      }
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") {
        removePartialFile(filePath, "cancellation");
        throw new Error("Download was cancelled by user.");
      }
      retries++;
      if (retries >= MAX_RETRIES) {
        if (filePath && (fileTotalSize === 0 || bytesDownloaded < fileTotalSize)) {
          removePartialFile(filePath, "download failure");
        }
        throw new Error(`(${filename || "Unknown file"}) Error occurred while downloading file: ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Max retries exceeded");
};
