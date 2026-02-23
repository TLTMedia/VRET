/**
 * Minimal type stub for babylonjs-editor.
 *
 * We only declare the Editor APIs this plugin actually uses.
 * The real babylonjs-editor package is massive (full Electron app) and
 * should NOT be installed as a dependency — BJSE provides itself at runtime.
 */
declare module "babylonjs-editor" {
  import { ReactNode } from "react";

  export interface IEditorLayoutTabOptions {
    id?: string;
    title: string;
    neighborId?: "inspector" | "assets-browser";
    enableClose?: boolean;
    setAsActiveTab?: boolean;
  }

  export interface EditorConsole {
    log(message: string): void;
    error(message: string): void;
    warn(message: string): void;
  }

  export interface EditorPreview {
    /** The live Babylon.js scene — use for direct scene manipulation */
    scene: any;
    canvas: HTMLCanvasElement;
  }

  export interface EditorLayout {
    addLayoutTab(component: ReactNode, options: IEditorLayoutTabOptions): void;
    removeLayoutTab(id: string): void;
    selectTab(id: string): void;
    console: EditorConsole;
    preview: EditorPreview;
  }

  export interface EditorState {
    /** Absolute path to the .json project file, or null if no project is open */
    projectPath: string | null;
    plugins: string[];
  }

  export interface Editor {
    state: EditorState;
    layout: EditorLayout;
    setState(state: Partial<EditorState>): void;
  }
}
