import type { LibraryPersistenceAdapter } from "@excalidraw/excalidraw/data/library";

// Minimal localStorage-backed adapter — the original app uses idb-keyval for
// this, but library payloads are small enough that localStorage is fine and
// avoids pulling in another runtime.

const LIBRARY_KEY = "excalidraw-library";

export const libraryAdapter: LibraryPersistenceAdapter = {
  async load() {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  async save(data) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(data));
  },
};
