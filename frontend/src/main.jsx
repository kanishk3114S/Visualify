import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initFrontendSentry } from "./lib/sentry.js";
import "./styles/index.css";
import App from "./App.jsx";

initFrontendSentry();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
