/**
 * VRM Plugin for Babylon.js Editor v5
 * 
 * Provides background support for VRM 1.0 models:
 *  - Registers VRM loader in the editor environment
 *  - (Planned) Automatically attaches VrmCharacter script to imported .vrm files
 */

import { Editor } from "babylonjs-editor";
import { loadVrmLoader } from "../../src/VrmLoader";

export const title = "VRM Plugin";
export const description = "Background support for VRM 1.0 models";

export async function main(editor: Editor): Promise<void> {
  if (!editor.state.projectPath) {
    return;
  }

  // Ensure VRM loader is available in the editor's scene
  try {
    await loadVrmLoader();
    editor.layout.console.log("[VRM Plugin] Loader registered.");

    // HACK: Try to tell the editor that .vrm is a valid mesh extension
    // In BJSE v5, assets-browser and other panels often check for specific extensions.
    // We try to inject .vrm into common extension lists if they exist.
    const anyEditor = editor as any;
    if (anyEditor.assetsBrowser) {
        const ab = anyEditor.assetsBrowser;
        // Some versions use an 'extensions' array or similar for filtering
        if (ab.extensions && Array.isArray(ab.extensions)) {
            if (!ab.extensions.includes("vrm")) {
                ab.extensions.push("vrm");
                editor.layout.console.log("[VRM Plugin] Added .vrm to assets browser extensions.");
            }
        }
    }
  } catch (err) {
    editor.layout.console.error(`[VRM Plugin] Failed to register loader: ${err}`);
  }

  // NOTE: BJSE doesn't provide a direct "onAssetImported" hook in the public Editor interface.
  // Automation of script attachment would require deeper integration or polling the scene.
  // For now, users can manually attach "scripts/VrmCharacter.ts" to any TransformNode.
}

export function close(editor: Editor): void {
  // Cleanup if needed
}
