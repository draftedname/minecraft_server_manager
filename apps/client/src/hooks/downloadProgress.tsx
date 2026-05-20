// MC Server GUI
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { getSocket } from "@/lib/socket";
import { Loader2 } from "lucide-react";

interface ProgressEvent {
  message: string;
  current: number;
  total: number;
}

interface ProgressState {
  visible: boolean;
  message: string;
  percent: number;
}

const ProgressContext = createContext<ProgressState>({ visible: false, message: "", percent: 0 });

export function useDownloadProgress() {
  return useContext(ProgressContext);
}

export function DownloadProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<ProgressState>({ visible: false, message: "", percent: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.on("download:progress", (data: ProgressEvent) => {
      const percent = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
      setProgress({ visible: true, message: data.message, percent });

      if (data.message === "Complete!") {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          setProgress({ visible: false, message: "", percent: 0 });
        }, 2000);
      }
    });

    return () => {
      socket.off("download:progress");
    };
  }, []);

  return (
    <ProgressContext.Provider value={progress}>
      {children}
      {progress.visible && (
        <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className="text-sm font-medium truncate">{progress.message}</p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground text-right">{progress.percent}%</p>
        </div>
      )}
    </ProgressContext.Provider>
  );
}

