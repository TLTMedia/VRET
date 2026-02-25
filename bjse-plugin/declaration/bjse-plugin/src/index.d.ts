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
 * Registration: Edit > Project... > Plugins > From local disk
 *   → point at this plugin's build/ folder
 */
import { Editor } from "babylonjs-editor";
export declare const title = "VRM Cast Plugin";
export declare const description = "Pick VRM models and VRMA animations, export cast.json for PlayController";
export declare function main(editor: Editor): Promise<void>;
export declare function close(editor: Editor): void;
