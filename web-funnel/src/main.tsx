import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import EtsyEntry from "./EtsyEntry";
import "../../public/styles/main.css";
import "../design/tokens.css";
import "../design/base.css";
import "./styles.css";

// The /etsy fulfilment surface shares this bundle but renders a self-contained
// landing instead of the funnel App. Everything else is the /create funnel.
const normalizedPath = location.pathname.replace(/\/$/, "");
const isEtsyLanding =
  normalizedPath === "/etsy" || normalizedPath === "/etsy/code";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isEtsyLanding ? <EtsyEntry /> : <App />}</StrictMode>,
);
