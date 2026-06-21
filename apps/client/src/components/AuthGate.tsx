import { useState, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { setAuthToken } from "@/lib/api";
import LoginPage from "@/pages/LoginPage";

interface Props {
  children: ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [checking, setChecking] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [serverOk, setServerOk] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("mcservergui-token");
    if (saved) setAuthToken(saved);

    const check = async () => {
      try {
        const { default: api } = await import("@/lib/api");
        const { data } = await api.get("/auth/status");
        if (!data.setup) {
          setNeedsAuth(true);
        } else if (saved) {
          try {
            await api.get("/servers");
            setNeedsAuth(false);
          } catch {
            setAuthToken(null);
            sessionStorage.removeItem("mcservergui-token");
            setNeedsAuth(true);
          }
        } else {
          setNeedsAuth(true);
        }
        setServerOk(true);
      } catch {
        setServerOk(false);
      }
      setChecking(false);
    };
    check();

    const onAuthRequired = () => {
      setNeedsAuth(true);
    };
    window.addEventListener("auth:required", onAuthRequired);
    return () => window.removeEventListener("auth:required", onAuthRequired);
  }, []);

  const handleAuthenticated = (newToken: string) => {
    sessionStorage.setItem("mcservergui-token", newToken);
    setAuthToken(newToken);
    setNeedsAuth(false);
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!serverOk) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Cannot connect to server</p>
      </div>
    );
  }

  if (needsAuth) {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  return <>{children}</>;
}
