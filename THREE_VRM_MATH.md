# VRM Animation Logic (Extracted from three-vrm)

## Core Concept: Normalized Humanoid Rig
`three-vrm` solves the "Bone Roll" and coordinate mismatch issues by creating a **virtual, normalized rig** that sits between the animation tracks and the actual GLTF model.

### 1. The Normalized Rig (`VRMHumanoidRig`)
*   A hierarchy of `Object3D` nodes is created mirroring the standard VRM Humanoid structure (`hips` -> `spine` -> `chest`...).
*   **Position:** Each node's position matches the **World Position** of the corresponding raw bone in the T-Pose (Rest Pose).
*   **Rotation:** Each node's rotation is set to **Identity**.
    *   This means in the Normalized Rig, "Forward" is always +Z, "Right" is always +X, regardless of how the actual GLTF bones are oriented.
*   **Hierarchy:** These nodes are parented to each other standardly.

### 2. Animation Application
*   VRMA (VRM Animation) tracks are applied to this **Normalized Rig**, not the raw bones.
*   Because the Normalized Rig is Identity-aligned, standard tracks (e.g., "Rotate X" for swing) work correctly without axis swapping.

### 3. Retargeting Formula (`update()`)
To map the normalized animation back to the raw GLTF bones, `three-vrm` uses a specific change-of-basis formula.

For every bone:
1.  **`Q_anim`**: The current rotation of the **Normalized Bone** (from the animation).
2.  **`P_world`**: The **World Rotation** of the raw bone's **Parent** in the **Rest Pose** (T-Pose).
3.  **`Q_rest`**: The **Local Rotation** of the **raw bone** in the **Rest Pose**.

**The Formula:**
```javascript
// RawBone.quaternion = inv(P_world) * Q_anim * P_world * Q_rest
```

**Mathematical Derivation:**
1.  We want to apply the rotation `Q_anim` (which is in Global Space because the normalized parent is Identity) to the bone.
2.  However, the bone exists in the coordinate system of its *Raw Parent*.
3.  The Raw Parent is rotated by `P_world`.
4.  To express "Global Rotation `Q_anim`" in the "Local Space of `P_world`", we perform a conjugation (Change of Basis):
    `Q_local_anim = inv(P_world) * Q_anim * P_world`
5.  Finally, we apply this local animation *on top of* the bone's existing rest rotation:
    `Q_final = Q_local_anim * Q_rest`

### 4. Special Case: Hips Position
For the `hips` (root), the position is applied directly:
```javascript
// Move the mass center of the VRM
if (boneName === 'hips') {
    const boneWorldPosition = rigBoneNode.getWorldPosition(_boneWorldPos);
    // ... apply to raw bone ...
}
```

## Implementation Strategy for Babylon.js

To port this logic faithfully:

1.  **Capture Rest Pose:**
    *   Iterate all humanoid bones.
    *   Store `Q_rest` (Local Rotation).
    *   Store `P_world` (Parent's World Rotation). *Crucial: For Hips, P_world is Identity (or Root rotation).*

2.  **Build Normalized Proxies:**
    *   Create a hierarchy of `TransformNodes`.
    *   Set rotations to Identity.
    *   Set positions to match Raw Bone World Positions (converted to local space of proxy parent).

3.  **Animate Proxies:**
    *   Apply VRMA tracks to these proxies.

4.  **Per-Frame Update:**
    *   For each bone, calculate: `inv(P_world) * Proxy.rotation * P_world * Q_rest`.
    *   Apply this to `RawBone.rotationQuaternion`.
