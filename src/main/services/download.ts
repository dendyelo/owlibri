import contentDisposition from "content-disposition";
import fs from "fs";
import path from "path";
import os from "os";

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

export const downloadFile = async ({
  downloadUrl,
  estimatedTotalBytes,
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
        if (!downloadContentDisposition) {
          throw new Error("No content-disposition header found");
        }

        const parsedContentDisposition = contentDisposition.parse(downloadContentDisposition);
        const fullFileName = parsedContentDisposition.parameters.filename;
        const sanitizedFileName = fullFileName.replace(/[\/\\:*?"<>|]/g, "_");
        const slicedFileName = sanitizedFileName.slice(
          Math.max(sanitizedFileName.length - MAX_FILE_NAME_LENGTH, 0)
        );
        
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
        }
        filePath = path.join(downloadDir, slicedFileName);
        filename = fullFileName;
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
        while (true) {
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
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
        throw new Error("Download was cancelled by user.");
      }
      retries++;
      if (retries >= MAX_RETRIES) {
        if (filePath && fs.existsSync(filePath) && bytesDownloaded < fileTotalSize) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
        throw new Error(`(${filename || "Unknown file"}) Error occurred while downloading file: ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Max retries exceeded");
};
