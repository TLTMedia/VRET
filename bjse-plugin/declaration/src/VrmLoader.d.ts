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
/** Inject the babylonjs-vrm CDN loader once. Idempotent. */
export declare function loadVrmLoader(): Promise<void>;
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
export declare function loadVrm(url: string, scene: any, pos?: {
    x: number;
    y: number;
    z: number;
}, rotY?: number): Promise<VrmModel>;
