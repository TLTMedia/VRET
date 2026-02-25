/**
 * app.ts — Babylon.js VRM + VRMA player (Vite entry point)
 *
 * Babylon.js and babylon-vrm-loader are loaded via CDN in index.html.
 * VrmaPlayer, Actor, and PlayController are proper TS modules importable
 * into any project including Babylon.js Editor (see bjse-project/).
 *
 * Coordinate space rules (all three must hold simultaneously):
 *   1. Camera alpha = -π/2  → avatar faces -Z, camera at -Z sees the front
 *   2. Rotation keyframes   → conjugate by 180°Y: (-qx, qy, -qz, qw)
 *   3. Hips position        → pre-negate X and Z before __root__ applies its flip
 */
export { VrmaPlayer } from './VrmaPlayer';
export { Actor } from './Actor';
export { PlayController } from './PlayController';
