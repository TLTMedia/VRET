/* global BABYLON */

(function () {
  const canvas = document.getElementById('renderCanvas');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const jsonInput = document.getElementById('jsonFile');
  const audioInput = document.getElementById('audioFile');
  const playBtn = document.getElementById('playBtn');
  const stopBtn = document.getElementById('stopBtn');

  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);
  scene.debugLayer.show();
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

  const camera = new BABYLON.ArcRotateCamera(
    'camera',
    Math.PI / 2,
    Math.PI / 2.2,
    2.0,
    new BABYLON.Vector3(0, 1.2, 0),
    scene
  );
  camera.attachControl(canvas, true);

  new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);

  const audio = new Audio();
  audio.preload = 'auto';

  let faceMesh = null;

  let vrmManager = null;
  let morphTargetByName = new Map();
  let vrmGroupNames = new Set();

  let jsonData = null;
  let times = null; // Float32Array
  let frames = null; // Array<{time:number, weights:Object}>
  let weightKeys = null; // Array<string>

  let isPlaying = false;
  let frameIndex = 0;

  // Basic ARKit/A2F -> VRM0 preset mapping (fallback to group/morph targets handled in code)
  const A2F_TO_VRM = {
    jawOpen: [{ type: 'preset', name: 'A', scale: 1.0 }],
    mouthFunnel: [{ type: 'preset', name: 'O', scale: 1.0 }],
    mouthPucker: [{ type: 'preset', name: 'U', scale: 1.0 }],
    eyeBlinkLeft: [{ type: 'preset', name: 'Blink_L', scale: 1.0 }],
    eyeBlinkRight: [{ type: 'preset', name: 'Blink_R', scale: 1.0 }]
  };

  const usedPresets = new Set();
  const usedGroups = new Set();
  const usedMorphTargets = new Set();

  function setStatus(lines) {
    statusEl.textContent = `Status:\n${lines.join('\n')}`;
  }

  function clamp01(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function buildMorphTargetCache() {
    const map = new Map();
    for (const mesh of scene.meshes) {
      const mtm = mesh.morphTargetManager;
      if (!mtm) continue;
      for (let i = 0; i < mtm.numTargets; i++) {
        const target = mtm.getTarget(i);
        if (target && typeof target.name === 'string' && !map.has(target.name)) {
          map.set(target.name, target);
        }
      }
    }
    return map;
  }

  function getLatestVrmManager() {
    const managers = scene.metadata && scene.metadata.vrmManagers;
    if (!managers || managers.length === 0) return null;
    return managers[managers.length - 1];
  }

  function applyMappedTarget(target, value) {
    const v = clamp01(value);

    if (!vrmManager) return;

    if (target.type === 'preset') {
      usedPresets.add(target.name);
      vrmManager.morphingPreset(target.name, v);
      return;
    }

    if (target.type === 'group') {
      usedGroups.add(target.name);
      vrmManager.morphing(target.name, v);
      return;
    }

    if (target.type === 'morphTarget') {
      const mt = morphTargetByName.get(target.name);
      if (!mt) return;
      usedMorphTargets.add(target.name);
      mt.influence = v;
    }
  }

  function applyWeight(a2fKey, value) {
      const v = clamp01(value);

      // 1순위: 메쉬의 Morph Target에 직접 해당 이름이 있는지 확인 (유저님 케이스)
      const mt = morphTargetByName.get(a2fKey);
      if (mt) {
          if (v > 0.1) console.log(`적용 중인 표정: ${a2fKey}, 값: ${v}`);
          usedMorphTargets.add(a2fKey);
          mt.influence = v;
          return; // 찾았으면 여기서 종료
      }

      // 2순위: VRM 프리셋 매핑 확인
      const mapping = A2F_TO_VRM[a2fKey];
      if (mapping) {
          for (const t of mapping) {
              applyMappedTarget(t, clamp01(v * (t.scale ?? 1.0)));
          }
          return;
      }

      // 3순위: VRM 그룹 이름 확인
      if (vrmManager && vrmGroupNames.has(a2fKey)) {
          usedGroups.add(a2fKey);
          vrmManager.morphing(a2fKey, v);
      }
  }

  function resetFace() {
    if (!vrmManager) return;

    for (const preset of usedPresets) {
      vrmManager.morphingPreset(preset, 0);
    }
    for (const group of usedGroups) {
      vrmManager.morphing(group, 0);
    }
    for (const name of usedMorphTargets) {
      const mt = morphTargetByName.get(name);
      if (mt) mt.influence = 0;
    }

    usedPresets.clear();
    usedGroups.clear();
    usedMorphTargets.clear();
  }

  function findFrameIndexForTime(t) {
    if (!times || times.length === 0) return 0;

    // Advance pointer forward only (playback is forward).
    while (frameIndex + 1 < times.length && times[frameIndex + 1] <= t) {
      frameIndex++;
    }

    // Handle rewind / restart.
    while (frameIndex > 0 && times[frameIndex] > t) {
      frameIndex--;
    }

    return frameIndex;
  }

  function updateLipSync() {
    if (!isPlaying || !frames || frames.length === 0) return;

    const t = audio.currentTime;
    const i = findFrameIndexForTime(t);
    const i1 = Math.min(i + 1, frames.length - 1);

    const t0 = times[i];
    const t1 = times[i1];
    const denom = (t1 - t0);
    const alpha = denom > 1e-6 ? (t - t0) / denom : 0;

    const w0 = frames[i].weights || {};
    const w1 = frames[i1].weights || {};

    // Apply all known keys each frame so missing keys decay to 0.
    for (const k of weightKeys) {
      const v0 = w0[k] ?? 0;
      const v1 = w1[k] ?? 0;
      applyWeight(k, lerp(v0, v1, alpha));
    }
  }

  async function loadVrmModel() {
    setStatus([
      'Loading VRM model…',
      'Model: ./a2f_AIAN_F_1_Casual_CLEANED.vrm'
    ]);

    await BABYLON.SceneLoader.AppendAsync('./', 'a2f_AIAN_F_1_Casual_CLEANED.vrm', scene);

    // 유저님이 찾으신 실제 메쉬 이름을 지정합니다.
    // __root__ 안의 계층 구조라도 이름으로 직접 찾을 수 있습니다.
    faceMesh = scene.getMeshByName("H_DDS_HighRes"); 

    if (faceMesh && faceMesh.morphTargetManager) {
        console.log("얼굴 메쉬와 모프 타겟 매니저를 찾았습니다!");
    } else {
        console.warn("H_DDS_HighRes 메쉬를 찾지 못했거나 MorphTargetManager가 없습니다.");
    }

    vrmManager = getLatestVrmManager();
    if (!vrmManager) {
      throw new Error('VRM loaded but VRMManager not found. Ensure babylon-vrm-loader is loaded.');
    }

    morphTargetByName = buildMorphTargetCache();

    const groupList = vrmManager.getMorphingList ? vrmManager.getMorphingList() : [];
    vrmGroupNames = new Set(groupList);

    setStatus([
      'VRM loaded',
      `VRM blendshape groups: ${groupList.length}`,
      `Morph targets cached: ${morphTargetByName.size}`,
      jsonData ? 'JSON loaded' : 'JSON not loaded',
      audio.src ? 'Audio loaded' : 'Audio not loaded'
    ]);
  }

  function loadJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed reading JSON file'));
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsText(file);
    });
  }

  async function handleJsonSelected(file) {
    jsonData = await loadJsonFile(file);

    if (!jsonData || typeof jsonData !== 'object') {
      throw new Error('Invalid JSON payload');
    }

    if (jsonData.fps !== 60) {
      throw new Error(`Expected fps=60, got fps=${jsonData.fps}`);
    }

    if (!Array.isArray(jsonData.data) || jsonData.data.length === 0) {
      throw new Error('JSON has no data frames');
    }

    frames = jsonData.data;
    times = new Float32Array(frames.length);

    const keySet = new Set();
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i];
      times[i] = Number(fr.time ?? 0);
      const w = fr.weights || {};
      for (const k of Object.keys(w)) keySet.add(k);
    }
    weightKeys = Array.from(keySet);

    // Reset playback pointer
    frameIndex = 0;

    setStatus([
      vrmManager ? 'VRM loaded' : 'VRM not loaded',
      `JSON loaded: ${frames.length} frames`,
      `Weight keys: ${weightKeys.length}`,
      audio.src ? 'Audio loaded' : 'Audio not loaded'
    ]);
  }

  async function handleAudioSelected(file) {
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.load();

    setStatus([
      vrmManager ? 'VRM loaded' : 'VRM not loaded',
      frames ? `JSON loaded: ${frames.length} frames` : 'JSON not loaded',
      'Audio loaded'
    ]);
  }

  function canPlay() {
    return Boolean(vrmManager && frames && times && weightKeys && audio.src);
  }

  async function onPlay() {
    if (!canPlay()) {
      setStatus([
        vrmManager ? 'VRM loaded' : 'VRM not loaded',
        frames ? 'JSON loaded' : 'JSON not loaded',
        audio.src ? 'Audio loaded' : 'Audio not loaded',
        'Not ready to play'
      ]);
      return;
    }

    resetFace();
    frameIndex = 0;
    audio.currentTime = 0;

    try {
      await audio.play();
    } catch (e) {
      setStatus([
        'Audio play blocked by browser.',
        'Click Play again after interacting with the page.'
      ]);
      return;
    }

    isPlaying = true;
    setStatus([
      'Playing…',
      `Frames: ${frames.length}`,
      `Keys: ${weightKeys.length}`
    ]);
  }

  function onStop() {
    isPlaying = false;
    audio.pause();
    audio.currentTime = 0;
    resetFace();

    setStatus([
      'Stopped',
      vrmManager ? 'VRM loaded' : 'VRM not loaded',
      frames ? 'JSON loaded' : 'JSON not loaded',
      audio.src ? 'Audio loaded' : 'Audio not loaded'
    ]);
  }

  jsonInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      await handleJsonSelected(file);
    } catch (err) {
      setStatus([`JSON error: ${err && err.message ? err.message : String(err)}`]);
    }
  });

  audioInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      await handleAudioSelected(file);
    } catch (err) {
      setStatus([`Audio error: ${err && err.message ? err.message : String(err)}`]);
    }
  });

  playBtn.addEventListener('click', () => {
    onPlay();
  });

  stopBtn.addEventListener('click', () => {
    onStop();
  });

  startBtn.addEventListener('click', () => {
    // Resume AudioContext for browser autoplay policy bypass
    if (audio && audio.play) {
      // Signal readiness
      setStatus([
        'Audio context resumed.',
        'You can now use Play button.',
        vrmManager ? 'VRM loaded' : 'VRM not loaded',
        frames ? 'JSON loaded' : 'JSON not loaded',
        audio.src ? 'Audio loaded' : 'Audio not loaded'
      ]);
    } else {
      setStatus(['AudioContext resume ready.']);
    }
  });

  audio.addEventListener('ended', () => {
    onStop();
  });

  scene.onBeforeRenderObservable.add(() => {
      // faceMesh가 로드된 후에만 작동하도록 방어 코드를 넣습니다.
      if (faceMesh && faceMesh.morphTargetManager) {
          const target = faceMesh.morphTargetManager.getTargetByName("jawOpen");
          if (target) {
              // 테스트용: 주석 해제하면 항상 입을 벌리고 있어야 합니다.
              // target.influence = 1.0; 
          }
      }

      if (vrmManager) {
          vrmManager.update(engine.getDeltaTime());
      }
      updateLipSync();
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Boot
  loadVrmModel().catch((err) => {
    setStatus([`VRM load error: ${err && err.message ? err.message : String(err)}`]);
  });
})();
