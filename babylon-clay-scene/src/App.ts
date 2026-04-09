import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";

import HavokPhysics from "@babylonjs/havok";

import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";

import "@babylonjs/core/Cameras/universalCamera";

import "@babylonjs/core/Meshes/groundMesh";

import "@babylonjs/core/Lights/directionalLight";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";

import "@babylonjs/core/Materials/PBR/pbrMaterial";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/XR/features/WebXRDepthSensing";

import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";

import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader";

import "@babylonjs/core/Physics";

import "@babylonjs/materials/sky";

import "@babylonjs/loaders/glTF";

// Set up minimal BABYLON global — A2FAvatar.js uses BABYLON.ImportMeshAsync
// and checks BABYLON.VRMFileLoader
(window as any).BABYLON = {
	...(window as any).BABYLON,
	ImportMeshAsync,
	SceneLoader,
};

// @ts-ignore
import { A2FAvatar } from '../A2FAvatar.js';

export class App {
	public canvas: HTMLCanvasElement;
	public engine: Engine | null = null;
	public scene: Scene | null = null;

	constructor() {
		const canvasElement = document.getElementById('canvas') as HTMLCanvasElement;
		if (!canvasElement) {
			throw new Error('Canvas element not found');
		}
		this.canvas = canvasElement;
	}

	public async init(): Promise<void> {
		this.engine = new Engine(this.canvas, true, {
			stencil: true,
			antialias: true,
			audioEngine: true,
			adaptToDeviceRatio: true,
			disableWebGL2Support: false,
			useHighPrecisionFloats: true,
			powerPreference: "high-performance",
			failIfMajorPerformanceCaveat: false,
		});

		this.scene = new Scene(this.engine);

		await this._handleLoad();

		// Handle window resize
		window.addEventListener("resize", () => {
			this.engine?.resize();
		});

		// Start render loop
		this.engine.runRenderLoop(() => {
			//console.log(this.scene?.activeCamera?.position);
			this.scene?.render();
		});
	}

	private async _handleLoad(): Promise<void> {
		if (!this.engine || !this.scene) { return; }

		const havok = await HavokPhysics();
		this.scene.enablePhysics(new Vector3(0, -981, 0), new HavokPlugin(true, havok));

		SceneLoader.ForceFullSceneLoadingForIncremental = true;
		await SceneLoader.AppendAsync("/scene/", "example.babylon", this.scene);
		await this.scene.whenReadyAsync();

		if (this.scene.activeCamera) {
			this.scene.activeCamera.attachControl();
		}

		// Load A2FAvatar from scene.json manifest
		// Can add more avatars here
		const avatar = new A2FAvatar(this.scene);
		await avatar.loadManifest('../scene.json');

		console.log('[App] Avatar loaded. rootNode:', avatar.rootNode?.name,
			'faceMesh:', avatar.faceMesh?.name, 'clips:', avatar.clips.length);

		if (avatar.rootNode) {
			avatar.rootNode.position = new Vector3(5000, 4.5, -400);
			// Scene uses cm units (gravity -981), VRM uses meters — scale up 100x
			avatar.rootNode.rotation = new Vector3(0, -4 * Math.PI / 3, 0);
			avatar.rootNode.scaling = new Vector3(175, 175, 175);
		}

		// Build clip playback UI
		this._createAvatarUI(avatar);
	}

	private _createAvatarUI(avatar: any): void {
		const container = document.createElement('div');
		container.style.cssText = 'position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:50;';

		const makeBtn = (label: string, onClick: () => void) => {
			const btn = document.createElement('button');
			btn.textContent = label;
			btn.style.cssText = 'padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-family:sans-serif;';
			btn.addEventListener('mouseenter', () => btn.style.background = '#1d4ed8');
			btn.addEventListener('mouseleave', () => btn.style.background = '#2563eb');
			btn.addEventListener('click', onClick);
			return btn;
		};

		container.appendChild(makeBtn('Play All', () => avatar.playSequence()));

		avatar.clips.forEach((clip: any, i: number) => {
			container.appendChild(makeBtn(clip.id, () => avatar.playClip(i)));
		});

		container.appendChild(makeBtn('Stop', () => avatar.stopAndReset()));

		document.body.appendChild(container);
	}

	public dispose(): void {
		this.scene?.dispose();
		this.engine?.dispose();
	}
} 
