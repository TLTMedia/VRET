# Solution to Prevent Position Shifting in VRMA Animation Queue

## Problem Description
When blending multiple VRMA animations in sequence, if an animation ends in a different position than where it started, the accumulated positional offset causes the avatar to drift or shift position over time. This creates an undesirable effect where the user appears to move unintentionally.

## Root Cause
The current implementation in `queue.html` simply cross-fades between animations without accounting for positional differences. When an animation has a net displacement (starts at position A, ends at position B), this displacement accumulates with each transition.

## Proposed Solution
Track and compensate for positional offsets between animations by:

1. Capturing the root bone position at the start and end of each animation
2. Calculating the positional delta for each animation
3. Applying inverse positional compensation during transitions
4. Maintaining a cumulative position offset that gets corrected over time

## Implementation Details

### Modified Component Schema
Add new properties to track position compensation:
```javascript
schema: {
    vrm: { type: 'string', default: '' },
    anims: { type: 'string', default: '' },
    blendDuration: { type: 'number', default: 0.5 },
    legSpread: { type: 'number', default: -0.5 },
    enablePositionCompensation: { type: 'boolean', default: true }  // New property
}
```

### Enhanced Animation Loading
Modify the `loadVRMA` function to capture positional data:
```javascript
loadVRMA: async function(url) {
    try {
        const gltf = await this.loader.loadAsync(url);
        const vrmAnimation = gltf.userData.vrmAnimations[0];
        if (vrmAnimation) {
            const clip = THREE.createVRMAnimationClip(vrmAnimation, this.vrm);
            
            // Capture root motion data if available
            const rootMotionData = this.extractRootMotionData(clip);
            
            const action = this.mixer.clipAction(clip);
            action.loop = THREE.LoopOnce;
            action.clampWhenFinished = true;
            
            // Store position compensation data with the action
            action.rootMotionData = rootMotionData;
            
            this.actions.push(action);
        }
    } catch (err) {
        console.error('Error loading animation:', url, err);
    }
}
```

### Root Motion Extraction
Add a helper function to extract positional data:
```javascript
extractRootMotionData: function(clip) {
    const rootBoneName = 'hips'; // or 'Hips', depending on convention
    const track = clip.tracks.find(t => t.name.includes(rootBoneName) && t.name.includes('position'));
    
    if (!track) {
        return null; // No root motion data available
    }
    
    return {
        startPosition: new THREE.Vector3().fromArray(track.values.slice(0, 3)),
        endPosition: new THREE.Vector3().fromArray(track.values.slice(-3))
    };
}
```

### Position Compensation Logic
Modify the `playNextAnimation` function to apply compensation:
```javascript
playNextAnimation: function(e) {
    if (this.data.enablePositionCompensation) {
        const lastAction = e.action;
        
        // Calculate the positional offset of the completed animation
        if (lastAction.rootMotionData) {
            const offset = new THREE.Vector3()
                .subVectors(
                    lastAction.rootMotionData.endPosition,
                    lastAction.rootMotionData.startPosition
                );
            
            // Store cumulative offset to compensate for
            if (!this.cumulativePositionOffset) {
                this.cumulativePositionOffset = new THREE.Vector3();
            }
            this.cumulativePositionOffset.add(offset);
        }
    }
    
    this.currentActionIndex = (this.currentActionIndex + 1) % this.actions.length;
    const nextAction = this.actions[this.currentActionIndex];

    console.log(`Fading from animation ${this.actions.indexOf(lastAction)} to ${this.currentActionIndex}`);

    nextAction.reset();
    nextAction.play();
    
    // Apply position compensation if enabled
    if (this.data.enablePositionCompensation && this.cumulativePositionOffset) {
        this.applyPositionCompensation(nextAction);
    }
    
    lastAction.crossFadeTo(nextAction, this.data.blendDuration, true);
}
```

### Apply Position Compensation
Add a function to apply compensation to the entity position:
```javascript
applyPositionCompensation: function(nextAction) {
    // Apply inverse of the cumulative offset to counteract drift
    const compensation = this.cumulativePositionOffset.clone().negate();
    
    // Apply compensation gradually over the blend duration
    const originalPosition = this.el.object3D.position.clone();
    const targetPosition = originalPosition.add(compensation);
    
    // Smoothly interpolate to the compensated position
    this.compensatePositionOverTime(originalPosition, targetPosition, this.data.blendDuration);
},

compensatePositionOverTime: function(startPos, endPos, duration) {
    const startTime = Date.now();
    const currentPosition = this.el.object3D.position.clone();
    
    const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed < duration) {
            const t = elapsed / duration;
            // Use smooth interpolation
            const newPos = new THREE.Vector3().lerpVectors(currentPosition, endPos, t);
            this.el.object3D.position.copy(newPos);
            requestAnimationFrame(animate);
        } else {
            this.el.object3D.position.copy(endPos);
            // Reset cumulative offset after compensation
            this.cumulativePositionOffset.set(0, 0, 0);
        }
    };
    
    animate();
}
```

### Tick Function Enhancement
Update the tick function to apply continuous compensation if needed:
```javascript
tick: function (time, deltaTime) {
    if (this.mixer) {
        this.mixer.update(deltaTime / 1000);
    }
    
    // Apply ongoing position compensation if active
    if (this.activePositionCompensation) {
        this.updatePositionCompensation(deltaTime);
    }
    
    this.updateLegSpread();
}
```

## Benefits
- Eliminates unwanted positional drift during animation sequences
- Maintains the intended animation movements while keeping the avatar in place
- Provides option to enable/disable compensation based on use case
- Preserves the original animation timing and blending behavior


The proposed solution offers the most flexibility while maintaining compatibility with existing animations.