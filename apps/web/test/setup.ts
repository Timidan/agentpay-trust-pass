// Global test setup: stub matchMedia before any module (e.g. GSAP ScrollTrigger)
// calls it during registration.
import { afterEach } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Theme persistence writes to localStorage; clear it between tests so a toggled
// theme in one test can't bleed into another test's <App/> initial theme.
afterEach(() => {
  window.localStorage.clear();
});
