import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initFrontendSentry } from "./lib/sentry.js";
import { initMotionReadiness } from "./motion/index.js";
import "./styles/index.css";
import App from "./App.jsx";

initFrontendSentry();
initMotionReadiness();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
