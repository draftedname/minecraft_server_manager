import { useState, useRef, useCallback, useEffect } from "react";
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
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (mountedRef.current) {
      setState({ uploading: false, progress: 0, error: null });
    }
  }, []);

  const upload = useCallback(
    async (
      file: File,
      destination: string,
      onComplete?: (path: string) => void
    ): Promise<boolean> => {
      if (!mountedRef.current) return false;
      setState({ uploading: true, progress: 0, error: null });

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      try {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        const { data: initData } = await api.post("/upload/init", {
          filename: file.name,
          totalChunks,
          destination,
        }, { signal });
        const { uploadId } = initData;

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
                  headers: { "Content-Type": "application/octet-stream" },
                  signal,
                }
              );
              break;
            } catch (err: any) {
              if (err?.name === "CanceledError" || err?.name === "AbortError") throw err;
              retries++;
              if (retries === maxRetries) throw new Error(`Chunk ${i} failed after ${maxRetries} retries`);
            }
          }

          if (!mountedRef.current) return false;
          setState((s) => ({ ...s, progress: Math.round(((i + 1) / totalChunks) * 100) }));
        }

        const { data: finalData } = await api.post(`/upload/${uploadId}/finalize`, {}, { signal });
        if (mountedRef.current) {
          setState({ uploading: false, progress: 100, error: null });
          onComplete?.(uploadId);
        }
        return true;
      } catch (err: any) {
        if (err?.name === "CanceledError") {
          if (mountedRef.current) {
            setState({ uploading: false, progress: 0, error: null });
          }
          return false;
        }
        const msg = err.response?.data?.error || err.message || "Upload failed";
        if (mountedRef.current) {
          setState({ uploading: false, progress: 0, error: msg });
        }
        return false;
      }
    },
    []
  );

  return { ...state, upload, cancel };
}
