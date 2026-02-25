// Paste into https://playground.babylonjs.com/
// Add as External Library in playground Settings:
//   https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js
//
// Fix over #5PQIS8: the original's vrmAnimationManager.rotationMap is always
// empty at runtime, so no correction was ever applied. The real fix is to
// remove each VRMA bone's baked rest pose before applying to the VRM:
//   q_delta = Inverse(q_vrma_rest) * q_keyframe
// Works for any VRMA regardless of what coordinate frame its source skeleton
// used. No 180°Y flip needed — VRM 1.x has an identity root in Babylon.

var createScene = async function () {
    // -----------------------------------------------------------------------
    // Scene
    // -----------------------------------------------------------------------
    var scene = new BABYLON.Scene(engine);

    var camera = new BABYLON.ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2 - 0.12, 5,
        new BABYLON.Vector3(0, 0.9, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 15;

    new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    var dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-1, -2, -1), scene);
    dir.intensity = 0.5;

    // -----------------------------------------------------------------------
    // Load VRM model
    // -----------------------------------------------------------------------
    var VRM_URL  = "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm";
    var VRMA_URL = "https://raw.githubusercontent.com/not-elm/bevy_vrm1/main/assets/vrma/VRMA_01.vrma";

    await BABYLON.ImportMeshAsync(VRM_URL, scene);
    var vrmManager = scene.metadata?.vrmManagers?.[0];
    if (!vrmManager) throw new Error("VRM manager not found");

    // VRM hips world height — used to scale VRMA translations to this skeleton
    var vrmHipsBone = vrmManager.humanoidBone["hips"];
    var vrmHipsY    = vrmHipsBone?.absolutePosition?.y
                    ?? vrmHipsBone?.getAbsolutePosition?.().y
                    ?? 1;

    // -----------------------------------------------------------------------
    // Load VRMA and retarget
    // -----------------------------------------------------------------------
    // Clear any stale animation managers from the VRM load
    if (scene.metadata?.vrmAnimationManagers) scene.metadata.vrmAnimationManagers = [];

    var assetContainer  = await BABYLON.LoadAssetContainerAsync(VRMA_URL, scene);
    var vrmAnimManager  = scene.metadata?.vrmAnimationManagers?.[0];
    var animGroup       = assetContainer.animationGroups[0];

    if (!vrmAnimManager?.animationMap || !animGroup) {
        throw new Error("No animation data found in VRMA");
    }

    // Translation scale: match VRMA skeleton proportions to VRM skeleton
    var translationScale = 1;
    var hipsEntry = [...vrmAnimManager.animationMap.entries()].find(([, n]) => n === "hips");
    if (hipsEntry) {
        var vrmaHipsY = animGroup.targetedAnimations[hipsEntry[0]]?.target?.absolutePosition?.y ?? 0;
        if (vrmaHipsY !== 0) translationScale = vrmHipsY / vrmaHipsY;
    }

    // Build corrected animation group
    var remapped = new BABYLON.AnimationGroup("vrma-retargeted");

    animGroup.targetedAnimations.forEach((targeted, i) => {
        var boneName = vrmAnimManager.animationMap.get(i);
        var bone     = vrmManager.humanoidBone[boneName];
        if (!bone) return;

        var anim = targeted.animation.clone("anim_" + boneName);

        if (anim.targetProperty === "rotationQuaternion") {
            // The VRMA skeleton has non-identity rest poses baked into its nodes
            // (e.g. Hips = 180° around X, Spine = -90° around X).
            // The keyframes are absolute local rotations, so we must remove the
            // rest pose to get the delta, then apply that delta to the VRM bone.
            //   q_delta = q_rest^{-1} * q_keyframe
            // Since VRM 1.x has an identity root node in Babylon, no additional
            // coordinate-system flip is needed.
            var restQ = (targeted.target.rotationQuaternion ?? BABYLON.Quaternion.Identity()).clone();
            var invRest = BABYLON.Quaternion.Inverse(restQ);
            anim.getKeys().forEach(kf => {
                kf.value = invRest.multiply(kf.value);
            });
        }

        if (anim.targetProperty === "position" && boneName === "hips") {
            // Remove VRMA hips rest translation, then scale to match VRM skeleton height.
            var restPos = targeted.target.position?.clone() ?? BABYLON.Vector3.Zero();
            anim.getKeys().forEach(kf => {
                var v = kf.value.subtract(restPos).scale(translationScale);
                kf.value = v;
            });
        }

        remapped.addTargetedAnimation(anim, bone);
    });

    // Apply frame 0 immediately to avoid a 1-frame T-pose flash
    remapped.start(true, 1.0, remapped.from, remapped.to, false);
    remapped.goToFrame(remapped.from);
    scene.render();

    console.log("[Done] tracks:", remapped.targetedAnimations.length,
                "translationScale:", translationScale.toFixed(3));

    return scene;
};

