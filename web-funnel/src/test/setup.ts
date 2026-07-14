import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

const localValues = new Map<string, string>();
const testLocalStorage: Storage = {
  get length() {
    return localValues.size;
  },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => localValues.delete(key),
  setItem: (key, value) => localValues.set(key, String(value)),
};

Object.defineProperty(window, "localStorage", { configurable: true, value: testLocalStorage });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: testLocalStorage });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

window.scrollBy = () => undefined;
Element.prototype.scrollIntoView = () => undefined;

HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close = function close() {
  this.open = false;
};
