/**
 * VRM Cast Plugin for Babylon.js Editor v5
 *
 * Adds a "VRM Cast" panel to the editor where you can:
 *  - Pick VRM models from public/models/
 *  - Pick VRMA animation clips from public/vrma/
 *  - Set actor positions and initial clips
 *  - Add timeline events (timed clip changes, stops)
 *  - Export scenes/cast.json consumed by PlayController
 *
 * Registration: Edit > Project... > Plugins > From local disk
 *   → point at this plugin's build/ folder
 */

import React from "react";
import { Editor } from "babylonjs-editor";
import { VrmCastPanel } from "./ui/VrmCastPanel";

export const title = "VRM Cast Plugin";
export const description = "Pick VRM models and VRMA animations, export cast.json for PlayController";

const TAB_ID = "vrm-cast-plugin-tab";

export function main(editor: Editor): void {
  if (!editor.state.projectPath) {
    editor.layout.console.error("[VRM Cast] No project open — open a project first.");
    return;
  }

  editor.layout.addLayoutTab(React.createElement(VrmCastPanel, { editor }), {
    id: TAB_ID,
    title: "VRM Cast",
    neighborId: "assets-browser",
    enableClose: false,
  });

  editor.layout.console.log("[VRM Cast] Panel ready.");
}

export function close(editor: Editor): void {
  editor.layout.removeLayoutTab(TAB_ID);
}
