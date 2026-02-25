/**
 * VrmLoader.ts — loads a VRM file into a Babylon.js scene.
 *
 * Mirrors the role of three-vrm's VRMLoaderPlugin:
 *   three-vrm:  loader.register(new VRMLoaderPlugin()); gltf.userData.vrm → VRM
 *   here:       await loadVrm(url, scene) → VrmModel
 *
 * The returned VrmModel is passed to buildVrmaClip() (VrmaLoader.ts) to retarget
 * animations, and to VrmaPlayer for playback state management.
 */

import { VrmModel } from './VrmModel';

const VRM_LOADER_URL = 'https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';

/** Lazy accessor — avoids capturing window.BABYLON at module load time. */
function getB(): any {
  const b = (window as any).BABYLON;
  if (!b) throw new Error('[VrmLoader] window.BABYLON is not set — call loadVrmLoader() first');
  return b;
}

/** Inject the babylonjs-vrm CDN loader once. Idempotent.
 *
 * Two strategies:
 *   Electron (BJSE): fetch + vm.runInThisContext — bypasses browser CSP on
 *     script tag injection that Electron's editor window often enforces.
 *     Also sets up window.BABYLON and window.LOADERS which the CDN script
 *     reads as free globals (babylon-vrm-loader.js uses them directly).
 *   Browser (babvrm.html, Vite): standard <script> tag injection
 *     (assumes window.BABYLON and window.LOADERS are already set by CDN scripts).
 *
 * Detection: process.versions.electron is set in Electron renderer processes.
 */
export async function loadVrmLoader(): Promise<void> {
  if ((window as any).__vrmLoaderReady) return;

  const isElectron = typeof process !== 'undefined'
    && !!(process as any).versions?.electron;

  if (isElectron) {
    // ── Set up window.BABYLON ──────────────────────────────────────────
    // babylon-vrm-loader.js reads window.BABYLON as a free global.
    // BJSE uses @babylonjs/core (ES modules) but also loads babylonjs (UMD)
    // via preload.js → require('babylonjs-materials') → require('babylonjs').
    // BJSE's overrides.js patches require() so 'babylonjs' resolves into the
    // app bundle, making require('babylonjs') work from our plugin context too.
    if (!(window as any).BABYLON) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (window as any).BABYLON = require('babylonjs');
      } catch {
        // Fallback: search require.cache for the already-loaded babylonjs module
        const babylon = findCachedModule('/node_modules/babylonjs/');
        if (babylon) (window as any).BABYLON = babylon;
      }
    }

    // ── Set up window.LOADERS ─────────────────────────────────────────
    // babylon-vrm-loader.js does `const Q = LOADERS` (free variable) — it
    // expects window.LOADERS to be the babylonjs-loaders namespace.
    // BJSE's overrides.js patches require so 'babylonjs-loaders' resolves
    // into the app bundle, and assets-browser.js pre-loads it so it is
    // already in require.cache.
    if (!(window as any).LOADERS) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (window as any).LOADERS = require('babylonjs-loaders');
      } catch {
        // Fallback: search require.cache
        const loaders = findCachedModule('/node_modules/babylonjs-loaders/');
        if (loaders) (window as any).LOADERS = loaders;
        else (window as any).LOADERS = (window as any).BABYLON; // last resort
      }
    }

    // ── Run the CDN script ────────────────────────────────────────────
    const resp = await fetch(VRM_LOADER_URL);
    if (!resp.ok) throw new Error(`[VrmLoader] CDN fetch failed: HTTP ${resp.status}`);
    const code = await resp.text();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vm: typeof import('vm') = require('vm');
    vm.runInThisContext(code);
  } else {
    // Browser: standard <script> tag
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = VRM_LOADER_URL;
      s.onload  = resolve as () => void;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  (window as any).__vrmLoaderReady = true;
}

/**
 * Search require.cache for a module whose resolved path contains `pathFragment`.
 * Used to locate already-loaded modules (e.g. 'babylonjs') without knowing
 * their exact path inside the app bundle.
 */
function findCachedModule(pathFragment: string): any {
  const cache = (require as any).cache as Record<string, { exports: any }>;
  for (const [key, mod] of Object.entries(cache)) {
    if (key.includes(pathFragment) && mod?.exports
        && typeof mod.exports === 'object' && !Array.isArray(mod.exports)) {
      return mod.exports;
    }
  }
  return null;
}

/**
 * Load a VRM file into the scene and return a VrmModel.
 *
 * Uses index-tracking to support multiple simultaneous VRM actors:
 * records vrmManagers.length before import, grabs the entry appended after.
 *
 * @param url   URL or path to the .vrm file
 * @param scene Babylon.js Scene
 * @param pos   World-space position for this actor (default origin)
 * @param rotY  Y-axis rotation in degrees (default 0)
 */
export async function loadVrm(
  url: string,
  scene: any,
  pos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  rotY = 0,
): Promise<VrmModel> {
  const B = getB();

  // Root node gives this actor its own world position/rotation
  const rootNode = new B.TransformNode(`vrm_root_${url}_${Date.now()}`, scene);
  rootNode.position = new B.Vector3(pos.x, pos.y, pos.z);
  rootNode.rotation = new B.Vector3(0, rotY * Math.PI / 180, 0);

  // Track state before import so we can isolate this VRM's manager and meshes
  const managersBefore = (scene.metadata?.vrmManagers ?? []).length;
  const meshCountBefore = scene.meshes.length;

  await B.ImportMeshAsync(url, scene);

  // Parent all newly-added root meshes to this actor's transform node
  const newMeshes = scene.meshes.slice(meshCountBefore);
  newMeshes.forEach((m: any) => {
    if (!m.parent) m.parent = rootNode;
  });

  // Grab the vrmManager appended by this import
  const managers = scene.metadata?.vrmManagers ?? [];
  const manager = managers[managersBefore] ?? managers[managers.length - 1];
  if (!manager) throw new Error(`[VrmLoader] No VRM manager found after loading ${url}`);

  const humanoidBone: Record<string, any> = manager.humanoidBone ?? {};
  const hips = humanoidBone['hips'];
  const hipsY = hips?.absolutePosition?.y ?? hips?.getAbsolutePosition?.().y ?? 1;

  return { manager, humanoidBone, hipsY, meshes: newMeshes, rootNode };
}
