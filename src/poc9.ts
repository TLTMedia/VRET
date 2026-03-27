import { loadVrm } from './VrmLoader';
import { buildVrmaClip } from './VrmaLoader9';

// 1. Loader Setup (Must happen before any mesh import)
const loadLoaders = async () => {
    // Load the base VRM loader (0.x)
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
    // Load the VRM 1.0 patch (Local)
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = './vrm1-loader.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
    (window as any).__vrmLoaderReady = true;
};

async function init() {
    await loadLoaders();

    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const BABYLON = (window as any).BABYLON;
    const engine = new BABYLON.Engine(canvas, true);
    const scene  = new BABYLON.Scene(engine);
    
    // Setup environment
    const camera = new BABYLON.ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2 - 0.12, 4, new BABYLON.Vector3(0, 1, 0), scene);
    camera.attachControl(canvas, true);
    new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    
    const descEl = document.getElementById('description')!;
    const statusEl = document.getElementById('status')!;
    const btn = document.getElementById('btn') as HTMLButtonElement;

    // 2. Load Model
    const params = new URLSearchParams(window.location.search);
    const VRM_FILE = params.get('model') || 'models/AIAN/AIAN_F_1_Casual.vrm';
    
    descEl.textContent = 'Loading VRM...';
    const vrm = await loadVrm(VRM_FILE, scene);
    console.log('[POC] VRM Loaded:', vrm);

    // 3. Load Animations list
    const animations = await fetch('animations.json').then(r => r.json());
    btn.style.display = 'block';

    let currentGroup: any = null;
    let currentContainer: any = null;

    async function playRandom() {
        const entry = animations[Math.floor(Math.random() * animations.length)];
        descEl.textContent = entry.description;
        statusEl.textContent = 'Retargeting ' + entry.url + '...';
        
        // Cleanup
        if (currentGroup) { currentGroup.stop(); currentGroup.dispose(); }
        if (currentContainer) { currentContainer.dispose(); }

        try {
            const clip = await buildVrmaClip(entry.url, vrm, scene);
            currentGroup = clip.group;
            currentContainer = clip.container;
            
            currentGroup.start(true, 1.0, currentGroup.from, currentGroup.to, false);
            statusEl.textContent = entry.url + ' (AnimatorAvatar)';
        } catch (e: any) {
            console.error(e);
            statusEl.textContent = 'Error: ' + e.message;
        }
    }

    btn.onclick = playRandom;
    await playRandom();

    engine.runRenderLoop(() => scene.render());
    window.onresize = () => engine.resize();
}

init().catch(console.error);
