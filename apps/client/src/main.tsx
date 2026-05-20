// MC Server GUI
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConsoleProvider } from "./hooks/consoleContext";
import { DownloadProgressProvider } from "./hooks/downloadProgress";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConsoleProvider>
        <DownloadProgressProvider>
          <App />
        </DownloadProgressProvider>
      </ConsoleProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

