const vrmLoaderScript = document.createElement('script');
vrmLoaderScript.src = 'https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';
document.head.appendChild(vrmLoaderScript);

var createScene = function() {
    var scene = new BABYLON.Scene(engine);

    var camera = new BABYLON.ArcRotateCamera("Camera", Math.PI / 2, Math.PI / 2, 10, BABYLON.Vector3.Zero(), scene);
    // var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);

    // This targets the camera to scene origin
    camera.setTarget(BABYLON.Vector3.Zero());

    // This attaches the camera to the canvas
    camera.attachControl(canvas, true);

    var vrmFile = 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm'
    var vrmaFile = 'https://raw.githubusercontent.com/not-elm/bevy_vrm1/main/assets/vrma/VRMA_01.vrma'
    // var vrmaFile = 'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm-animation/examples/models/test.vrma'

    vrmLoaderScript.onload = () => {
        BABYLON.ImportMeshAsync(
            vrmFile,
            scene
        ).then(() => {
            BABYLON.LoadAssetContainerAsync(
                vrmaFile,
                scene
            ).then((assetContainer) => {
                // console.log(assetContainer)

                let vrmAnimationManager = scene.metadata.vrmAnimationManagers[0];

                let animationGroup = assetContainer.animationGroups[0]
                let animation = animationGroup.targetedAnimations[0].animation

                const newAnimationGroup = new BABYLON.AnimationGroup("new-animation-group");

                animationGroup.targetedAnimations.forEach((animation, indexAnimation) => {
                    let boneName = scene.metadata.vrmAnimationManagers[0].animationMap.get(indexAnimation)

                    if (false
                            && boneName != 'hips'
                            && boneName != 'spine'
                            && boneName != 'chest'
                            && boneName != 'upperChest'
                            && boneName != 'leftShoulder'
                            && boneName != 'leftLowerArm'
                            && boneName != 'leftUpperArm'
                            && boneName != 'leftHand'
                            && boneName != 'rightShoulder'
                            && boneName != 'rightLowerArm'
                            && boneName != 'rightUpperArm'
                            && boneName != 'rightHand'
                            && boneName != 'leftUpperLeg'
                            && boneName != 'leftLowerLeg'
                            && boneName != 'leftToes'
                            && boneName != 'rightUpperLeg'
                            && boneName != 'rightLowerLeg'
                            && boneName != 'rightToes'
                        ) {
                        return;
                    }

                    function toGrade(vector3) {
                        return {
                            x: (vector3.x / Math.PI * 180).toFixed(2),
                            y: (vector3.y / Math.PI * 180).toFixed(2),
                            z: (vector3.z / Math.PI * 180).toFixed(2),
                        }
                    }

                    let anima = animation.animation
                    // console.log(anima)
                    if (anima.targetProperty == 'rotationQuaternion') {
                        let childQuaternion = vrmAnimationManager.rotationMap.get(boneName)

                        let parentName = vrmAnimationManager.parentMap.get(boneName)
                        let parentNode = vrmAnimationManager.rotationMap.get(parentName)
                        let parentQuaternion = BABYLON.Quaternion.Zero()
                        if (parentNode) {
                            parentQuaternion = parentNode
                        }

                        // console.log(boneName, toGrade(childQuaternion.toEulerAngles()), childQuaternion)
                        // console.log(boneName, toGrade(parentQuaternion.toEulerAngles()), parentQuaternion)

                        anima.getKeys().forEach((keyFrame) => {
                            let quaternion = keyFrame.value
                            if (childQuaternion) {
                                childQuaternion = childQuaternion.invert()

                                // console.log(boneName, 'before', toGrade(quaternion.toEulerAngles()), quaternion)
                                // console.log(boneName, 'after', toGrade(childQuaternion.multiply(quaternion).toEulerAngles()), childQuaternion.multiply(quaternion))

                                // quaternion = quaternion.multiply(qua)
                                // quaternion = qua.multiply(quaternion)

                                // console.log(boneName, toGrade(quaternion.toEulerAngles()), quaternion)

                                // quaternion = quaternion.multiply(parentQuaternion).multiply(childQuaternion)
                                // quaternion = quaternion.multiply(childQuaternion)
                                quaternion = childQuaternion.multiply(quaternion) //.multiply(parentQuaternion)

                                keyFrame.value = quaternion;

                            }
                        })
                    } else if (anima.targetProperty == 'position') {
                        let vec = vrmAnimationManager.translationMap.get(boneName)
                        anima.getKeys().forEach((keyFrame) => {
                            let position = keyFrame.value
                            if (vec) {
                                // console.log(qua)
                                // console.log(qua.invert(), qua)
                                position = position.subtract(vec)
                                // console.log(quaternion)
                                keyFrame.value = position;
                            }
                        })
                    } else {
                        console.log('unsupport', anima.targetProperty)
                    }

                    let bone = scene.metadata.vrmManagers[0].humanoidBone[boneName]
                    if (!bone) {
                        // bone = scene.meshes[0]
                        return
                    }

                    newAnimationGroup.addTargetedAnimation(anima, bone);
                })

                // scene.addAnimationGroup(newAnimationGroup);
                newAnimationGroup.start(true, 1.0, newAnimationGroup.from, newAnimationGroup.to, true)

            })
        })
    };
    return scene;
};
export default createScene
