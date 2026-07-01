import { createRoot } from "react-dom/client";
import App from "./App";
import { LivingField } from "./shared/LivingField";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const reactRoot = createRoot(root);

// Prototype playground, isolated from the real app: open with /verdict-reveal
// or the older #verdict-reveal shortcut.
// Lazy-imported so three.js stays out of the main app bundle.
const isVerdictRevealDemo =
  typeof window !== "undefined" &&
  (window.location.pathname === "/verdict-reveal" || window.location.hash.replace(/^#/, "") === "verdict-reveal");

if (isVerdictRevealDemo) {
  void import("./trust/VerdictRevealDemo").then(({ default: VerdictRevealDemo }) => {
    reactRoot.render(<VerdictRevealDemo />);
  });
} else {
  reactRoot.render(
    <>
      <LivingField />
      <App />
    </>
  );
}
