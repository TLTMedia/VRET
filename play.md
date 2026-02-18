# Proposal: VRE "Play" System (Machinima Engine)

Building upon the foundation of `sequence.html`, this proposal outlines a robust, user-friendly system for creating multi-character performances (plays/machinima) within the VRM Environment (VRE).

## 1. Core Concept: The "Script"
Instead of a simple list of animations, we move to a **Scene Script** (JSON-based) that defines the entire performance.

### Example Script Structure (`scene_01.json`)
```json
{
  "metadata": {
    "title": "The Encounter",
    "description": "A hero meets a stranger in the park",
    "environment": "forest"
  },
  "actors": [
    { 
      "id": "hero", 
      "vrm": "models/Asian/Asian_F_1_Casual.vrm", 
      "startPosition": {"x": 0, "y": 0, "z": 5},
      "startRotation": {"y": 180}
    },
    { 
      "id": "stranger", 
      "vrm": "models/Black/Black_M_1_Busi.vrm", 
      "startPosition": {"x": 2, "y": 0, "z": 0},
      "startRotation": {"y": 0}
    }
  ],
  "timeline": [
    {
      "start": 0.0,
      "actor": "hero",
      "action": "animate",
      "clip": "vrma/02_01.vrma",
      "loop": true,
      "duration": 4.0,
      "description": "Walking forward"
    },
    {
      "start": 0.0,
      "actor": "hero",
      "action": "move",
      "to": {"x": 0, "y": 0, "z": 1},
      "duration": 4.0
    },
    {
      "start": 4.5,
      "actor": "stranger",
      "action": "animate",
      "clip": "vrma/111_37.vrma",
      "description": "Wave"
    },
    {
      "start": 5.0,
      "actor": "stranger",
      "action": "speak",
      "audio": "audio/houston.wav",
      "lipSync": "audio/houston.json",
      "text": "Hello! Welcome to the VRM Environment."
    }
  ]
}
```

## 2. Technical Architecture

### `vrm-play-controller` (The Brain)
A global A-Frame component for the `<a-scene>` that:
- Loads the `.json` script.
- Spawns and manages `actors`.
- Synchronizes a global clock for the timeline.
- Provides `play()`, `pause()`, `seek(time)`, and `stop()` methods.

### `vrm-actor` (The Performer)
An entity component that:
- Wraps the `vrm` component.
- Handles internal state (current animation, current speech).
- Manages **blending** between animations (e.g., transition from `walk` to `idle` when a move finishes).
- Implements the `speak` action by coordinating audio playback with facial morph targets (visemes).

### `vrm-timeline-engine`
A utility library to:
- Parse the script and schedule events.
- Handle "Action Groups" (animations that must sync with audio or movement).
- Manage assets: Pre-loading VRMs and VRMAs before the play starts.

## 3. Key Robustness Features

- **Asset Buffering**: The system will parse the script and ensure all VRM/VRMA files are in memory *before* allowing the "Play" button to be clicked.
- **Blending & IK**: Uses Three.js `AnimationMixer` cross-fading for smooth transitions between scripted actions.
- **Lip-Sync Integration**: Automatic mapping of Rhubarb/Oculus visemes from JSON to VRM expressions (A, I, U, E, O).
- **Enhanced Expression & ARKit Support**: The system is designed to leverage models processed by `vrm_cleanup_enhanced.py`. These "Cleaned" models provide:
    - **Standardized Visemes**: Reliable mapping for `A, I, U, E, O, F, M, S, CH, K, N`.
    - **ARKit Compatibility**: Access to 52 granular facial shapes (e.g., `eyeBlinkLeft`, `jawOpen`, `mouthSmile`) for high-fidelity emotional performances.
    - **Teeth Syncing**: Automatic driving of teeth meshes during speech.
- **Coordinate System**: Support for both absolute positions and relative offsets (e.g., "move 2 meters forward").

## 4. User-Friendly Interface

### The "Director's View"
A debug overlay that provides:
- **Timeline Slider**: Scrub through the performance.
- **Actor Labels**: Floating names above characters.
- **Log Console**: See exactly which action is triggering and any errors (e.g., "Missing VRMA: walk.vrma").

### Integration with `animations.json`
Since we have over 1000 animations indexed, the system can allow actors to call animations by their `description` or `id` from the existing database.

## 5. Implementation Roadmap

1. **Phase 1: Multi-Actor Sync**: Create a component that can play two different VRMAs on two different characters simultaneously.
2. **Phase 2: JSON Script Parser**: Implement the timeline logic to trigger actions at specific timestamps.
3. **Phase 3: Movement & Speech**: Add the `move` and `speak` commands to the script interpreter.
4. **Phase 4: UI & Polish**: Create the on-screen controls for play/pause/scrub.

---
*This system transforms the VRE from a model viewer into a creative engine for storytelling and performance.*
