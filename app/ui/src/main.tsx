import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Bundled fonts (local woff2, no CDN / no network at runtime).
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./theme/tokens.css";
import "./theme/global.css";
import "./App.css";
import { ThemeProvider } from "./theme/ThemeProvider";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
