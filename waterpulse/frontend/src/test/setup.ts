import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => { cleanup(); localStorage.clear(); });

// jsdom lacks <dialog> modal methods and matchMedia.
HTMLDialogElement.prototype.showModal ||= function showModal(this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ||= function close(this: HTMLDialogElement) {
  this.removeAttribute("open");
};
window.matchMedia ||= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent: () => false
})) as unknown as typeof window.matchMedia;
