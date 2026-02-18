/**
 * VRM Play System (Machinima Engine)
 * Handles multi-character scripts, synchronized timelines, and blended animations.
 */

// Global Script Controller
AFRAME.registerComponent('vrm-play-controller', {
    schema: {
        src: { type: 'string', default: '' },
        autoplay: { type: 'boolean', default: true },
        debug: { type: 'boolean', default: false }
    },

    init: function () {
        this.script = null;
        this.actors = new Map(); // id -> el
        this.currentTime = 0;
        this.isPlaying = false;
        this.timelineIndex = 0;
        this.isLoaded = false;

        if (this.data.src) {
            this.loadScript(this.data.src);
        }
    },

    loadScript: async function (url) {
        try {
            console.log("Loading script:", url);
            const response = await fetch(url);
            this.script = await response.json();
            console.log("Script loaded:", this.script.metadata.title);

            // 1. Spawn Actors
            this.spawnActors();

            // 2. Wait for all actors to be ready
            this.checkActorsReady();
        } catch (e) {
            console.error("Failed to load script:", e);
        }
    },

    spawnActors: function () {
        this.script.actors.forEach(actorData => {
            const el = document.createElement('a-entity');
            el.setAttribute('id', actorData.id);
            el.setAttribute('vrm-actor', {
                vrm: actorData.vrm
            });
            
            // Set initial position/rotation
            el.setAttribute('position', actorData.startPosition);
            el.setAttribute('rotation', actorData.startRotation || {x: 0, y: 0, z: 0});
            
            this.el.sceneEl.appendChild(el);
            this.actors.set(actorData.id, el);
        });
    },

    checkActorsReady: function () {
        let readyCount = 0;
        const totalActors = this.actors.size;

        const onActorReady = () => {
            readyCount++;
            if (readyCount === totalActors) {
                console.log("All actors ready. Sequence prepared.");
                this.isLoaded = true;
                if (this.data.autoplay) this.start();
            }
        };

        this.actors.forEach(el => {
            if (el.components['vrm-actor'] && el.components['vrm-actor'].isReady) {
                onActorReady();
            } else {
                el.addEventListener('actor-ready', onActorReady);
            }
        });
    },

    start: function () {
        console.log("Starting play...");
        this.isPlaying = true;
        this.currentTime = 0;
        this.timelineIndex = 0;
        this.el.emit('play-started');
    },

    pause: function () {
        this.isPlaying = false;
        this.el.emit('play-paused');
    },

    tick: function (t, dt) {
        if (!this.isPlaying || !this.isLoaded) return;

        const deltaS = dt / 1000;
        this.currentTime += deltaS;

        // Check timeline for events
        while (this.timelineIndex < this.script.timeline.length) {
            const event = this.script.timeline[this.timelineIndex];
            
            if (this.currentTime >= event.start) {
                this.triggerEvent(event);
                this.timelineIndex++;
            } else {
                break;
            }
        }

        // Check if finished
        if (this.timelineIndex >= this.script.timeline.length) {
            // Optional: loop or stop
        }
    },

    triggerEvent: function (event) {
        const actorEl = this.actors.get(event.actor);
        if (!actorEl) {
            console.warn(`Actor not found: ${event.actor}`);
            return;
        }

        if (this.data.debug) console.log(`[${this.currentTime.toFixed(2)}s] Actor ${event.actor}: ${event.action}`, event);

        // Forward action to actor component
        actorEl.components['vrm-actor'].handleAction(event);
    }
});

// Actor Component
AFRAME.registerComponent('vrm-actor', {
    schema: {
        vrm: { type: 'string', default: '' }
    },

    init: function () {
        this.vrm = null;
        this.mixer = null;
        this.isReady = false;
        this.currentAction = null;
        this.audio = null;
        this.lipSyncData = null;
        this.mesh = null; // For visemes

        this.el.addEventListener('model-loaded', (evt) => {
            this.vrm = evt.detail.vrm;
            this.mixer = new THREE.AnimationMixer(this.vrm.scene);
            
            // Find face mesh for visemes
            this.vrm.scene.traverse(node => {
                if (node.isMesh && (node.name.includes('Face') || node.name.includes('HighRes'))) {
                    this.mesh = node;
                }
            });

            this.isReady = true;
            this.el.emit('actor-ready');
        });

        this.el.setAttribute('vrm', 'src', this.data.vrm);
    },

    handleAction: function (action) {
        switch (action.action) {
            case 'animate':
                this.playAnimation(action);
                break;
            case 'move':
                this.moveTo(action);
                break;
            case 'speak':
                this.speak(action);
                break;
            case 'rotate':
                this.rotateTo(action);
                break;
        }
    },

    playAnimation: function (data) {
        const loader = new THREE.GLTFLoader();
        loader.register(parser => new THREE.VRMAnimationLoaderPlugin(parser));

        loader.load(data.clip, (gltf) => {
            const vrmAnimations = gltf.userData.vrmAnimations;
            if (!vrmAnimations || vrmAnimations.length === 0) return;

            const clip = THREE.createVRMAnimationClip(vrmAnimations[0], this.vrm);
            const action = this.mixer.clipAction(clip);
            
            action.setLoop(data.loop ? THREE.LoopRepeat : THREE.LoopOnce);
            action.clampWhenFinished = !data.loop;
            
            if (this.currentAction) {
                action.reset().crossFadeFrom(this.currentAction, 0.5, true).play();
            } else {
                action.play();
            }
            this.currentAction = action;
        });
    },

    moveTo: function (data) {
        const startPos = this.el.getAttribute('position');
        const endPos = data.to;
        const duration = (data.duration || 1) * 1000;
        
        // Simple interpolation (could use TWEEN.js if available)
        this.el.setAttribute('animation__move', {
            property: 'position',
            to: `${endPos.x} ${endPos.y} ${endPos.z}`,
            dur: duration,
            easing: 'linear'
        });
    },

    rotateTo: function (data) {
        const endRot = data.to;
        const duration = (data.duration || 1) * 1000;
        
        this.el.setAttribute('animation__rotate', {
            property: 'rotation',
            to: `${endRot.x} ${endRot.y} ${endRot.z}`,
            dur: duration,
            easing: 'easeInOutQuad'
        });
    },

    speak: async function (data) {
        // Load Audio
        if (this.audio) this.audio.stop();
        
        const listener = new THREE.AudioListener();
        this.audio = new THREE.Audio(listener);
        const audioLoader = new THREE.AudioLoader();
        
        audioLoader.load(data.audio, (buffer) => {
            this.audio.setBuffer(buffer);
            this.audio.play();
        });

        // Load Lip Sync if available
        if (data.lipSync) {
            const resp = await fetch(data.lipSync);
            this.lipSyncData = await resp.json();
        }
    },

    tick: function (t, dt) {
        if (this.mixer) this.mixer.update(dt / 1000);

        // Handle Lip Sync visemes
        if (this.audio && this.audio.isPlaying && this.lipSyncData && this.mesh) {
            const currentTime = this.audio.context.currentTime - this.audio.startTime;
            this.updateLipSync(currentTime);
        }
    },

    updateLipSync: function (time) {
        // Find current mouth cue
        const cues = this.lipSyncData.mouthCues;
        const currentCue = cues.find(c => time >= c.start && time <= c.end);
        
        // Map Rhubarb values to VRM visemes
        const map = {
            'A': 'A', 'B': 'M', 'C': 'E', 'D': 'I', 'E': 'O', 'F': 'U', 'G': 'F', 'H': 'I', 'X': 'Basis'
        };

        const viseme = currentCue ? map[currentCue.value] : 'Basis';
        
        // Reset all visemes (simplified approach)
        ['A', 'I', 'U', 'E', 'O', 'F', 'M'].forEach(v => {
            this.applyViseme(v, 0);
        });

        if (viseme !== 'Basis') {
            this.applyViseme(viseme, 1.0);
        }
    },

    applyViseme: function (name, value) {
        if (!this.mesh || !this.mesh.morphTargetDictionary) return;
        const idx = this.mesh.morphTargetDictionary[name];
        if (idx !== undefined) {
            this.mesh.morphTargetInfluences[idx] = value;
        }
    }
});
