import { useState, useEffect } from "react";
import { Server, Key, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";

interface Props {
  onAuthenticated: (token: string) => void;
}

export default function LoginPage({ onAuthenticated }: Props) {
  const [loading, setLoading] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/auth/status").then(({ data }) => {
      setHasPassword(data.setup);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleCreatePassword = async () => {
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/set-password", { password });
      onAuthenticated(data.token);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to set password");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async () => {
    setError("");
    if (!password) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", { password });
      onAuthenticated(data.token);
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Server className="mx-auto h-10 w-10 text-primary" />
          <CardTitle className="mt-2">
            {hasPassword ? "Log In" : "Create Password"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {hasPassword
              ? "Enter your password to continue"
              : "Set a password to protect your servers"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (hasPassword ? handleLogin() : handleCreatePassword())}
              placeholder={hasPassword ? "Enter password" : "Choose a password"}
              autoFocus
            />
          </div>
          {!hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreatePassword()}
                placeholder="Repeat password"
              />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button
            className="w-full"
            onClick={hasPassword ? handleLogin : handleCreatePassword}
            disabled={submitting || !password}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Key className="h-4 w-4" />
            )}
            {hasPassword ? "Log In" : "Create Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
