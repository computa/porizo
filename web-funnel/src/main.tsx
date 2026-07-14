import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "../../public/styles/main.css";
import "../design/tokens.css";
import "../design/base.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
