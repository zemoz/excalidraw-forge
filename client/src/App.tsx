import {
  Excalidraw,
  LiveCollaborationTrigger,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useRef, useState } from "react";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { useCollab } from "./collab";
import { libraryAdapter } from "./library-adapter";

const STORAGE_KEY = "excalidraw-scene";

function loadScene() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt data
  }
  return null;
}

function App() {
  const [initialData] = useState(loadScene);
  const collab = useCollab();
  const [copied, setCopied] = useState(false);
  // useHandleLibrary needs the API as React state (not a ref) so it can
  // re-run when the API becomes available.
  const [excalidrawAPI, setExcalidrawAPIState] =
    useState<ExcalidrawImperativeAPI | null>(null);

  useHandleLibrary({ excalidrawAPI, adapter: libraryAdapter });

  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            theme: appState.theme,
          },
          files,
        }),
      );
      collab.onChange(elements, files);
    },
    [collab],
  );

  const handleAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setExcalidrawAPIState(api);
      collab.setExcalidrawAPI(api);
    },
    [collab],
  );

  const toggleCollab = useCallback(() => {
    if (collab.isCollaborating) {
      collab.stopCollab();
    } else {
      void collab.startCollab();
    }
  }, [collab]);

  const copyLink = useCallback(async () => {
    if (!collab.roomLink) return;
    await navigator.clipboard.writeText(collab.roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [collab.roomLink]);

  // Hover state for the share-link popover. The grace-period timer lets the
  // user move the cursor from the trigger button onto the popover (to click
  // Copy) without it dismissing.
  const [shareHovered, setShareHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showShare = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShareHovered(true);
  }, []);
  const hideShareSoon = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShareHovered(false), 200);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={handleAPI}
        onChange={handleChange}
        isCollaborating={collab.isCollaborating}
        onPointerUpdate={collab.onPointerUpdate}
        renderTopRightUI={() => (
          <div
            onMouseEnter={showShare}
            onMouseLeave={hideShareSoon}
            style={{ position: "relative", display: "inline-flex" }}
          >
            <LiveCollaborationTrigger
              isCollaborating={collab.isCollaborating}
              onSelect={toggleCollab}
            />
            {collab.isCollaborating && collab.roomLink && shareHovered && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "white",
                  border: "1px solid #d0d0d0",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  fontSize: 13,
                  zIndex: 10,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ opacity: 0.7 }}>Share link:</span>
                <code
                  style={{
                    maxWidth: 320,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    background: "#f4f4f4",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {collab.roomLink}
                </code>
                <button
                  type="button"
                  onClick={copyLink}
                  style={{
                    border: "1px solid #d0d0d0",
                    background: copied ? "#d4edda" : "white",
                    borderRadius: 4,
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}

export default App;
