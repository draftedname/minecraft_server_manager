import * as React from "react";
import { cn } from "@/lib/utils";

const ToastContext = React.createContext<{
  toast: (props: ToastProps) => void;
}>({ toast: () => {} });

interface ToastProps {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

interface ToastItem extends ToastProps {
  id: string;
}

let toastId = 0;
let listeners: Array<(toast: ToastItem) => void> = [];

function toast(props: ToastProps) {
  const id = String(++toastId);
  const item = { ...props, id };
  listeners.forEach((l) => l(item));
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const listener = (item: ToastItem) => {
      setToasts((prev) => [...prev, item]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 4000);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  return { toasts, toast };
}

export { toast, useToast };

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-80 items-center gap-2 rounded-lg border border-border bg-card p-4 shadow-lg",
            t.variant === "destructive" && "border-destructive bg-destructive/10 text-destructive"
          )}
        >
          <div className="flex-1">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && (
              <p className="text-xs text-muted-foreground">{t.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
