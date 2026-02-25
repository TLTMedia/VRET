/**
 * VRM Cast Plugin for Babylon.js Editor v5
 *
 * Adds a "VRM Cast" panel to the editor where you can:
 *  - Pick VRM models from public/models/
 *  - Pick VRMA animation clips from public/vrma/
 *  - Set actor positions and initial clips
 *  - Add timeline events (timed clip changes, stops)
 *  - Export scenes/cast.json consumed by PlayController
 *  - Preview VRMs with animations directly in the BJSE editor scene
 *
 * React isolation:
 *  BJSE renders a plain <div> placeholder in its own React tree.
 *  We call ReactDOM.createRoot() on that div to mount VrmCastPanel
 *  in a completely separate React tree.  This prevents the
 *  "two React instances / invalid hook call" crash and ensures our
 *  errors never reach BJSE's componentDidCatch.
 *
 * Registration: Edit > Project... > Plugins > From local disk
 *   → point at this plugin's build/ folder
 */

import React from "react";
import { createRoot, Root } from "react-dom/client";
import { Editor } from "babylonjs-editor";
import { VrmCastPanel } from "./ui/VrmCastPanel";

export const title = "VRM Cast Plugin";
export const description = "Pick VRM models and VRMA animations, export cast.json for PlayController";

const TAB_ID = "vrm-cast-plugin-tab";

/** Our isolated React root — one per plugin instance. */
let _root: Root | null = null;

/** Catches React render errors and shows them inside the tab (never reaches BJSE). */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div style={{
          color: "#f88",
          padding: "14px",
          fontFamily: "monospace",
          fontSize: "12px",
          background: "#1e1e1e",
          height: "100%",
          whiteSpace: "pre-wrap",
          overflowY: "auto",
          boxSizing: "border-box",
        }}>
          {"VRM Cast — render error:\n\n"}{err.message}{"\n\n"}{err.stack ?? ""}
        </div>
      );
    }
    return this.props.children;
  }
}

export function main(editor: Editor): void {
  if (!editor.state.projectPath) {
    editor.layout.console.error("[VRM Cast] No project open — open a project first.");
    return;
  }

  // Pass a plain div to BJSE's layout.  BJSE renders it in its own React tree.
  // We use a ref callback so that when the div is mounted to the DOM we
  // immediately create OUR OWN React root inside it.  VrmCastPanel and all its
  // hooks run in our isolated tree → no two-instance conflict, no white screen.
  const mountElement = React.createElement("div", {
    style: { width: "100%", height: "100%", overflow: "hidden" },
    ref: (el: HTMLDivElement | null) => {
      if (el) {
        if (!_root) {
          _root = createRoot(el);
          _root.render(
            <ErrorBoundary>
              <VrmCastPanel editor={editor} />
            </ErrorBoundary>
          );
        }
      } else {
        // Div unmounted — tear down our React root
        if (_root) {
          _root.unmount();
          _root = null;
        }
      }
    },
  });

  editor.layout.addLayoutTab(mountElement, {
    id: TAB_ID,
    title: "VRM Cast",
    neighborId: "assets-browser",
    enableClose: false,
  });

  editor.layout.console.log("[VRM Cast] Panel ready.");
}

export function close(editor: Editor): void {
  if (_root) {
    _root.unmount();
    _root = null;
  }
  editor.layout.removeLayoutTab(TAB_ID);
}
