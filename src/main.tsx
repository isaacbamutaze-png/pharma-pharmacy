import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { requestPersistentStorage } from "./lib/backup";

void requestPersistentStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline-capable web app (Netlify/PWA). Skipped in dev and inside the
// Android/Electron shells, which already bundle the app locally.
if (
  "serviceWorker" in navigator &&
  location.protocol === "https:" &&
  location.hostname !== "localhost"
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline shell is optional */
    });
  });
}
