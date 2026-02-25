/**
 * VrmCastPanel.tsx — main UI for the VRM Cast plugin.
 *
 * Scans public/models/ for .vrm files and public/vrma/ for .vrma files.
 * Lets you build a cast (actors + timeline) and exports scenes/cast.json
 * in the PlayController SceneScript format.
 *
 * Preview: loads VRMs directly into the BJSE editor preview scene and plays
 * each actor's initial clip using the same VrmLoader / VrmaLoader pipeline
 * used by the runtime PlayController.
 */
import { Editor } from "babylonjs-editor";
interface Props {
    editor: Editor;
}
export declare function VrmCastPanel({ editor }: Props): import("react/jsx-runtime").JSX.Element;
export {};
