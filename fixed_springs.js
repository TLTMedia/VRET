// Start loading the VRM loader immediately (parallel with createScene setup)
const _vrmLoaderReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
});

var createScene = async function() {
    var scene = new BABYLON.Scene(engine);

    // VRM avatar faces -Z in Babylon after the loader's 180°Y root correction.
    // Camera at z=-3 (on the -Z side) looking toward +Z sees the front.
    var camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 1.2, -3), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1.2, 0));
    camera.attachControl(canvas, true);

    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);

    var vrmFile  = 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm';
    var vrmaFile = 'https://raw.githubusercontent.com/not-elm/bevy_vrm1/main/assets/vrma/VRMA_01.vrma';

    await _vrmLoaderReady;

    await BABYLON.ImportMeshAsync(vrmFile, scene);
    const vrmManager = scene.metadata?.vrmManagers?.[0];
    if (!vrmManager) { console.error('VRM manager not found'); return scene; }

    // Spring bone controller — VRM 1.0 uses springBoneController10, VRM 0.x uses springBoneController.
    // The loader auto-registers its own observer but calling update() explicitly here gives us
    // correct delta time and ensures it runs after the animation has moved the skeleton.
    const springController = vrmManager.springBoneController10 ?? vrmManager.springBoneController ?? null;
    if (springController) {
        console.log('[Spring bones] controller found:', springController.constructor?.name ?? 'unknown');
        let _lastMs = performance.now();
        scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            const dt  = Math.min((now - _lastMs) / 1000, 0.05); // cap at 50ms to avoid jumps
            _lastMs   = now;
            springController.update(dt);
        });
    } else {
        console.log('[Spring bones] no controller found on this model');
    }

    const assetContainer = await BABYLON.LoadAssetContainerAsync(vrmaFile, scene);
    const vrmAnimManager = scene.metadata?.vrmAnimationManagers?.[0];
    const animGroup      = assetContainer.animationGroups[0];

    if (!vrmAnimManager?.animationMap || !animGroup) {
        console.error('No animation data found');
        return scene;
    }

    const newAnimationGroup = new BABYLON.AnimationGroup("vrma-retargeted");

    animGroup.targetedAnimations.forEach((targeted, i) => {
        const boneName = vrmAnimManager.animationMap.get(i);
        if (!boneName) return;

        // humanoidBone exposes bones via prototype getters; nodeMap is the safe fallback
        const bone = vrmManager.humanoidBone[boneName]
                  ?? vrmManager.humanoidBone?.nodeMap?.[boneName];
        if (!bone) return;

        // Clone so we don't mutate the original VRMA keyframes
        const anim = targeted.animation.clone(targeted.animation.name + '_retargeted');

        if (anim.targetProperty === 'rotationQuaternion') {
            // VRMA quaternions are in glTF right-handed space.
            // Babylon is left-handed and __root__ carries a 180°Y rotation.
            // Conjugating by 180°Y maps (x,y,z,w) → (-x, y, -z, w).
            anim.getKeys().forEach(kf => {
                const q = kf.value;
                kf.value = new BABYLON.Quaternion(-q.x, q.y, -q.z, q.w);
            });

        } else if (anim.targetProperty === 'position') {
            // Same handedness flip for hips translation.
            // __root__'s 180°Y means local(x,y,z) lands at world(-x,y,-z),
            // so pre-negate X and Z so the world direction is correct.
            anim.getKeys().forEach(kf => {
                const v = kf.value;
                kf.value = new BABYLON.Vector3(-v.x, v.y, -v.z);
            });
        }

        newAnimationGroup.addTargetedAnimation(anim, bone);
    });

    newAnimationGroup.start(true, 1.0, newAnimationGroup.from, newAnimationGroup.to, false);

    return scene;
};

export default createScene;
