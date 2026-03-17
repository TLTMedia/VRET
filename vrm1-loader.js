/**
 * vrm1-loader.js — VRM 1.0 (VRMC_vrm) extension for Babylon.js
 */
(function () {
  'use strict';

  const EXT_NAME = 'VRMC_vrm';
  const ANIM_EXT_NAME = 'VRMC_vrm_animation';

  class VRM1Extension {
    constructor(loader) {
      this.loader  = loader;
      this.name    = EXT_NAME;
      this.enabled = true;
    }
    dispose() { this.loader = null; }
    onReady() {
      const ext = this.loader.gltf?.extensions?.[EXT_NAME];
      if (!ext) return;
      const humanBones = ext?.humanoid?.humanBones;
      if (!humanBones) return;

      const scene = this.loader.babylonScene;
      const nodeByName = new Map();
      for (const tn of scene.transformNodes) nodeByName.set(tn.name, tn);
      for (const mesh of scene.meshes) if (!nodeByName.has(mesh.name)) nodeByName.set(mesh.name, mesh);

      const humanoidBone = { nodeMap: {} };
      for (const [boneName, boneData] of Object.entries(humanBones)) {
        const nodeIndex = boneData?.node;
        if (nodeIndex == null) continue;
        const gltfNodeName = this.loader.gltf.nodes?.[nodeIndex]?.name;
        const node = gltfNodeName ? nodeByName.get(gltfNodeName) : null;
        if (node) {
          humanoidBone[boneName] = node;
          humanoidBone.nodeMap[boneName] = node;
        }
      }
      if (!scene.metadata) scene.metadata = {};
      if (!scene.metadata.vrmManagers) scene.metadata.vrmManagers = [];
      scene.metadata.vrmManagers.push({
        humanoidBone,
        humanBones, // RAW MAP: boneName -> { node: index }
        meta: ext.meta || {},
        isVRM1: true
      });
      console.log(`[VRM1] Mapped ${Object.keys(humanoidBone.nodeMap).length} humanoid bones`);
    }
  }

  class VRM1AnimationExtension {
    constructor(loader) {
      this.loader  = loader;
      this.name    = ANIM_EXT_NAME;
      this.enabled = true;
    }
    dispose() { this.loader = null; }
    onReady() {
      const ext = this.loader.gltf?.extensions?.[ANIM_EXT_NAME];
      if (!ext) return;
      const scene = this.loader.babylonScene;
      const humanBones = ext.humanoid?.humanBones;
      if (!humanBones) return;

      const animationMap = new Map(); // VRMA nodeIdx  → boneName
      const nameMap      = new Map(); // VRMA nodeName → boneName
      for (const [boneName, boneData] of Object.entries(humanBones)) {
        if (boneData.node != null) {
          animationMap.set(boneData.node, boneName);
          const nodeName = this.loader.gltf.nodes?.[boneData.node]?.name;
          if (nodeName) nameMap.set(nodeName, boneName);
        }
      }

      if (!scene.metadata) scene.metadata = {};
      if (!scene.metadata.vrmAnimationManagers) scene.metadata.vrmAnimationManagers = [];
      scene.metadata.vrmAnimationManagers.push({ animationMap, nameMap });
      console.log('[VRM1] VRMC_vrm_animation extension ready — nameMap size:', nameMap.size);
    }
  }

  function register() {
    const GL = BABYLON?.GLTF2?.GLTFLoader;
    if (!GL) {
      setTimeout(register, 50);
      return;
    }
    GL.RegisterExtension(EXT_NAME, loader => new VRM1Extension(loader));
    GL.RegisterExtension(ANIM_EXT_NAME, loader => new VRM1AnimationExtension(loader));
    console.log('[VRM1] VRM 1.0 extensions registered');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  } else {
    register();
  }
})();
