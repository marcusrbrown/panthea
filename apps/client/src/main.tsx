import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./inspect/Root";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
