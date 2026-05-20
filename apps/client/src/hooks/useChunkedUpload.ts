// MC Server GUI
import { useState, useCallback } from "react";
import api from "@/lib/api";

const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB

interface UploadState {
  uploading: boolean;
  progress: number;
  error: string | null;
}

export function useChunkedUpload() {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
  });

  const upload = useCallback(
    async (
      file: File,
      destination: string,
      onComplete?: (path: string) => void
    ): Promise<boolean> => {
      setState({ uploading: true, progress: 0, error: null });

      try {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        // Step 1: Init upload
        const { data: initData } = await api.post("/upload/init", {
          filename: file.name,
          totalChunks,
          destination,
        });
        const { uploadId } = initData;

        // Step 2: Upload each chunk
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          let retries = 0;
          const maxRetries = 3;

          while (retries < maxRetries) {
            try {
              await api.post(
                `/upload/${uploadId}/chunk/${i}`,
                chunk,
                {
                  headers: {
                    "Content-Type": "application/octet-stream",
                  },
                }
              );
              break;
            } catch {
              retries++;
              if (retries === maxRetries) throw new Error(`Chunk ${i} failed after ${maxRetries} retries`);
            }
          }

          setState((s) => ({
            ...s,
            progress: Math.round(((i + 1) / totalChunks) * 100),
          }));
        }

        // Step 3: Finalize
        const { data: finalData } = await api.post(`/upload/${uploadId}/finalize`);
        setState({ uploading: false, progress: 100, error: null });
        onComplete?.(finalData.path);
        return true;
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message || "Upload failed";
        setState({ uploading: false, progress: 0, error: msg });
        return false;
      }
    },
    []
  );

  return { ...state, upload };
}

