import { createRoot } from "react-dom/client";
import App from "./App";
import { LivingField } from "./shared/LivingField";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <>
    <LivingField />
    <App />
  </>
);
