/**
 * VrmCastPanel.tsx — main UI for the VRM Cast plugin.
 *
 * Sections (top → bottom, matching BJSE interaction patterns):
 *
 *  1. VRM Models  — asset-browser thumbnail grid (click tile = add actor).
 *  2. Scene Cast  — collapsible actor cards.  Clip field shows current assignment
 *                   + clear button; assignment comes from the VRMA Library below.
 *  3. VRMA Library — search-as-you-type + category groups (mirrors BJSE skeleton
 *                    "Animation Ranges" list).  Scans both public/vrma/ (project-
 *                    local) and vrma/ in the VRE project root (full library).
 *                    ▶  = audition in scene (file:// URL, no copy needed).
 *                    clip name click = assign to target actor (auto-copies to
 *                    public/vrma/ if it comes from the library folder).
 *  4. Timeline Events — timed clip changes after t=0.
 *  5. Export — writes public/scenes/cast.json for PlayController.
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, CSSProperties
} from "react";
import { Editor } from "babylonjs-editor";
import { dirname, join, basename, extname } from "path";
import { readdir, outputJSON, pathExists, ensureDir, copy, outputFile } from "fs-extra";
import { loadVrm, loadVrmLoader } from "../../../src/VrmLoader";
import { VrmModel } from "../../../src/VrmModel";
import { VrmaPlayer } from "../../../src/VrmaPlayer";

// ── Types ──────────────────────────────────────────────────────────────────

interface ActorEntry {
  id: string;
  vrm: string;          // relative from public/, e.g. "models/Alicia.vrm"
  x: number; y: number; z: number;
  rotY: number;
  initialClip: string;  // relative from public/, e.g. "vrma/13_01.vrma"
  loop: boolean;
}

interface EventEntry {
  start: number;
  actor: string;
  action: "animate" | "stop";
  clip: string;
  loop: boolean;
}

/** A single VRMA file entry — tracks both display name and absolute OS path. */
interface VrmaEntry {
  name: string;   // filename only, e.g. "13_01.vrma"
  abs:  string;   // absolute OS path (for file:// loading and fs.copy)
  local: boolean; // true = already in public/vrma/ (can be used in cast.json as-is)
}

interface LoadedActor {
  vrm: VrmModel;
  player: VrmaPlayer;
}

interface Props { editor: Editor; }

// ── Helpers ────────────────────────────────────────────────────────────────

function toFileUrl(p: string): string {
  const norm = p.replace(/\\/g, "/");
  return norm.startsWith("/") ? `file://${norm}` : `file:///${norm}`;
}

function stem(filePath: string): string {
  return basename(filePath, extname(filePath));
}

function nextActorId(existing: ActorEntry[]): string {
  const ids = new Set(existing.map(a => a.id));
  let n = existing.length + 1;
  while (ids.has(`actor${n}`)) n++;
  return `actor${n}`;
}

function categoryOf(name: string): string {
  return name.split("_")[0];
}

/**
 * Walk up the directory tree from `startDir` looking for a `vrma/` folder
 * that contains at least one .vrma file.  Returns the folder path or null.
 */
async function findVrmaLibraryDir(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "vrma");
    if (await pathExists(candidate)) {
      const files = await readdir(candidate);
      if (files.some(f => f.toLowerCase().endsWith(".vrma"))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

// ── SVG icons ──────────────────────────────────────────────────────────────

const PersonIcon = () => (
  <svg viewBox="0 0 32 46" width="26" height="36" fill="none">
    <circle cx="16" cy="7"  r="6.5" fill="#5a9f7a"/>
    <rect x="10" y="15" width="12" height="15" rx="3" fill="#5a9f7a"/>
    <line x1="10" y1="19" x2="1"  y2="30" stroke="#5a9f7a" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="22" y1="19" x2="31" y2="30" stroke="#5a9f7a" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="14" y1="30" x2="10" y2="44" stroke="#5a9f7a" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="18" y1="30" x2="22" y2="44" stroke="#5a9f7a" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────

export function VrmCastPanel({ editor }: Props) {
  // File lists
  const [vrmFiles,     setVrmFiles]     = useState<string[]>([]);
  const [localVrmas,   setLocalVrmas]   = useState<string[]>([]);  // relative from public/
  const [allVrmaEntries, setAllVrmaEntries] = useState<VrmaEntry[]>([]);

  // Cast data
  const [actors,  setActors]  = useState<ActorEntry[]>([]);
  const [events,  setEvents]  = useState<EventEntry[]>([]);

  // UI state
  const [expanded,     setExpanded]     = useState<Set<number>>(new Set());
  const [loadedIds,    setLoadedIds]    = useState<Set<string>>(new Set());
  const [vrmaSearch,   setVrmaSearch]   = useState("");
  const [vrmaTarget,   setVrmaTarget]   = useState<string>("");    // actor id for assignment
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [status,       setStatus]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [loadErr,      setLoadErr]      = useState("");
  const [assignMsg,    setAssignMsg]    = useState("");

  // Runtime refs
  const loadedActors   = useRef<Map<string, LoadedActor>>(new Map());
  const vrmFileInputRef = useRef<HTMLInputElement>(null);

  // Keep vrmaTarget pointing at the first actor when actors list changes
  useEffect(() => {
    if (!vrmaTarget && actors.length > 0) setVrmaTarget(actors[0].id);
  }, [actors, vrmaTarget]);

  useEffect(() => { scanFiles(); }, []);

  // ── File scanning ──────────────────────────────────────────────────────

  const scanFiles = useCallback(async () => {
    if (!editor.state.projectPath) return;
    const pub = join(dirname(editor.state.projectPath), "public");

    // — VRM files —
    const vrms: string[] = [];
    try {
      const d = join(pub, "models");
      if (await pathExists(d)) {
        const files = await readdir(d);
        vrms.push(...files.filter(f => f.toLowerCase().endsWith(".vrm")).map(f => `models/${f}`));
      }
    } catch { /* absent */ }
    setVrmFiles(vrms);

    // — Local VRMA files (public/vrma/) —
    const localSet = new Set<string>();
    const local: VrmaEntry[] = [];
    try {
      const d = join(pub, "vrma");
      if (await pathExists(d)) {
        const files = await readdir(d);
        for (const f of files.filter(f => f.toLowerCase().endsWith(".vrma"))) {
          localSet.add(f);
          local.push({ name: f, abs: join(d, f), local: true });
        }
      }
    } catch { /* absent */ }
    setLocalVrmas(local.map(e => `vrma/${e.name}`));

    // — Library VRMA files — walk up from project dir to find a vrma/ folder —
    // Works whether the BJSE project is inside the VRE repo or a standalone project.
    const library: VrmaEntry[] = [];
    try {
      const libraryDir = await findVrmaLibraryDir(dirname(editor.state.projectPath));
      if (libraryDir) {
        const files = await readdir(libraryDir);
        for (const f of files.filter(f => f.toLowerCase().endsWith(".vrma"))) {
          if (!localSet.has(f)) {
            library.push({ name: f, abs: join(libraryDir, f), local: false });
          }
        }
      }
    } catch { /* absent */ }

    setAllVrmaEntries([...local, ...library]);
  }, [editor.state.projectPath]);

  // ── VRMA grouping (memoised) ───────────────────────────────────────────

  const groupedVrmas = useMemo<Map<string, VrmaEntry[]>>(() => {
    const map = new Map<string, VrmaEntry[]>();
    for (const e of allVrmaEntries) {
      const cat = categoryOf(e.name);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(e);
    }
    return map;
  }, [allVrmaEntries]);

  const filteredGroups = useMemo<Map<string, VrmaEntry[]>>(() => {
    const q = vrmaSearch.trim().toLowerCase();
    if (!q) return groupedVrmas;
    const result = new Map<string, VrmaEntry[]>();
    for (const [cat, entries] of groupedVrmas) {
      const matches = entries.filter(e =>
        e.name.toLowerCase().includes(q) || cat.includes(q)
      );
      if (matches.length) result.set(cat, matches);
    }
    return result;
  }, [groupedVrmas, vrmaSearch]);

  // Auto-expand categories when searching
  useEffect(() => {
    if (vrmaSearch.trim()) {
      setExpandedCats(new Set(filteredGroups.keys()));
    }
  }, [vrmaSearch, filteredGroups]);

  // ── VRM import from disk ───────────────────────────────────────────────

  async function handleVrmImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = (e.target.files ?? [])[0];
    if (!file || !editor.state.projectPath) return;
    const dest = join(dirname(editor.state.projectPath), "public", "models");
    await ensureDir(dest);
    // file.path is Electron <32 only; Electron 32+ removed it.
    const srcPath: string | undefined = (file as any).path;
    if (srcPath) {
      await copy(srcPath, join(dest, file.name));
    } else {
      await outputFile(join(dest, file.name), Buffer.from(await file.arrayBuffer()));
    }
    await scanFiles();
    e.target.value = "";
  }

  // ── Actor CRUD ─────────────────────────────────────────────────────────

  function addActorFromVrm(vrmPath: string) {
    const idx = actors.length;
    setActors(prev => [...prev, {
      id:          nextActorId(prev),
      vrm:         vrmPath,
      x:           idx * 1.5, y: 0, z: 0,
      rotY:        0,
      initialClip: "",
      loop:        true,
    }]);
    setExpanded(prev => new Set([...prev, idx]));
    // Point the VRMA browser at the new actor
    setVrmaTarget(nextActorId(actors));
  }

  function removeActor(i: number) {
    const id = actors[i]?.id;
    if (id) unloadActorFromScene(id);
    setActors(prev => prev.filter((_, idx) => idx !== i));
    setExpanded(prev => {
      const next = new Set<number>();
      prev.forEach(n => { if (n < i) next.add(n); else if (n > i) next.add(n - 1); });
      return next;
    });
  }

  function patchActor(i: number, patch: Partial<ActorEntry>) {
    setActors(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }

  function toggleExpand(i: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
    // Point VRMA browser at the actor being expanded
    if (!expanded.has(i)) setVrmaTarget(actors[i]?.id ?? vrmaTarget);
  }

  // ── Event CRUD ─────────────────────────────────────────────────────────

  function addEvent() {
    setEvents(prev => [...prev, {
      start: 5, actor: actors[0]?.id ?? "",
      action: "animate", clip: localVrmas[0] ?? "", loop: true,
    }]);
  }
  function removeEvent(i: number) { setEvents(prev => prev.filter((_, idx) => idx !== i)); }
  function patchEvent(i: number, p: Partial<EventEntry>) {
    setEvents(prev => prev.map((e, idx) => idx === i ? { ...e, ...p } : e));
  }

  // ── VRMA assignment & audition ─────────────────────────────────────────

  /** Assign a VRMA clip to an actor.  Copies from the library to public/vrma/ if needed. */
  async function assignClip(actorId: string, entry: VrmaEntry) {
    if (!editor.state.projectPath) return;
    const idx = actors.findIndex(a => a.id === actorId);
    if (idx < 0) return;

    let relativePath = `vrma/${entry.name}`;

    if (!entry.local) {
      // Copy from VRE library to public/vrma/
      const dest = join(dirname(editor.state.projectPath), "public", "vrma");
      const destFile = join(dest, entry.name);
      try {
        if (!(await pathExists(destFile))) {
          await ensureDir(dest);
          await copy(entry.abs, destFile);
          await scanFiles();
          setAssignMsg(`Copied ${entry.name} → public/vrma/`);
          setTimeout(() => setAssignMsg(""), 3000);
        }
      } catch (err: any) {
        setAssignMsg(`Copy failed: ${err?.message ?? err}`);
        return;
      }
    }

    patchActor(idx, { initialClip: relativePath });
  }

  /** Audition (play in scene without assigning). Uses absolute OS path directly. */
  async function auditionClip(actorId: string, entry: VrmaEntry) {
    const loaded = loadedActors.current.get(actorId);
    if (!loaded) {
      setLoadErr(`Load "${actorId}" into scene first to audition clips.`);
      setTimeout(() => setLoadErr(""), 4000);
      return;
    }
    await loaded.player.play(entry.abs, /* loop */ true);
  }

  // ── Per-actor scene loading ────────────────────────────────────────────

  async function loadActorInScene(i: number) {
    const actor = actors[i];
    if (!actor || !editor.state.projectPath) return;
    if (loadedIds.has(actor.id)) return;

    const scene = editor.layout.preview?.scene;
    if (!scene) { setLoadErr("No BJSE preview scene."); return; }

    setLoadErr("");
    setLoadedIds(prev => new Set([...prev, `__loading__${actor.id}`]));

    try {
      const pub    = join(dirname(editor.state.projectPath), "public");
      const vrmUrl = join(pub, actor.vrm);
      await loadVrmLoader();
      const vrm = await loadVrm(vrmUrl, scene,
        { x: actor.x, y: actor.y, z: actor.z }, actor.rotY);
      const player = new VrmaPlayer(scene, vrm);

      if (actor.initialClip) {
        const vrmaUrl = join(pub, actor.initialClip);
        await player.play(vrmaUrl, actor.loop);
      }

      loadedActors.current.set(actor.id, { vrm, player });
      setLoadedIds(prev => {
        const n = new Set(prev); n.delete(`__loading__${actor.id}`); n.add(actor.id); return n;
      });
      editor.layout.console.log(`[VRM Cast] ${actor.id} loaded`);
    } catch (err: any) {
      setLoadedIds(prev => { const n = new Set(prev); n.delete(`__loading__${actor.id}`); return n; });
      const msg = err?.message ?? String(err);
      setLoadErr(msg);
      editor.layout.console.error(`[VRM Cast] ${msg}`);
    }
  }

  async function playInScene(actorId: string, clipRelPath: string, loop: boolean) {
    const loaded = loadedActors.current.get(actorId);
    if (!loaded || !editor.state.projectPath) return;
    const pub     = join(dirname(editor.state.projectPath), "public");
    const vrmaUrl = join(pub, clipRelPath);
    await loaded.player.play(vrmaUrl, loop);
  }

  function unloadActorFromScene(actorId: string) {
    const loaded = loadedActors.current.get(actorId);
    if (!loaded) return;
    loaded.player.dispose();
    loaded.vrm.rootNode?.dispose();
    loadedActors.current.delete(actorId);
    setLoadedIds(prev => { const n = new Set(prev); n.delete(actorId); return n; });
  }

  // ── Export ─────────────────────────────────────────────────────────────

  async function exportCast() {
    if (!editor.state.projectPath) return;
    const pub = join(dirname(editor.state.projectPath), "public");

    const t0events = actors
      .filter(a => a.initialClip)
      .map(a => ({ start: 0, actor: a.id, action: "animate" as const, clip: a.initialClip, loop: a.loop }));

    const laterEvents = events.map(e => ({
      start: e.start, actor: e.actor, action: e.action,
      ...(e.action === "animate" ? { clip: e.clip, loop: e.loop } : {}),
    }));

    const script = {
      metadata: { title: "VRM Cast", description: "Generated by VRM Cast Plugin" },
      actors: actors.map(a => ({
        id: a.id, vrm: a.vrm,
        startPosition: { x: a.x, y: a.y, z: a.z },
        startRotation: { y: a.rotY },
      })),
      timeline: [...t0events, ...laterEvents].sort((a, b) => a.start - b.start),
    };

    try {
      await ensureDir(join(pub, "scenes"));
      await outputJSON(join(pub, "scenes", "cast.json"), script, { spaces: 2 });
      const msg = `Saved cast.json — ${actors.length} actors, ${script.timeline.length} events`;
      setStatus({ msg, ok: true });
      editor.layout.console.log(`[VRM Cast] ${msg}`);
    } catch (err: any) {
      setStatus({ msg: `Export failed: ${err?.message ?? err}`, ok: false });
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────

  const S: Record<string, CSSProperties> = {
    panel:      { padding: "10px", fontFamily: "monospace", fontSize: "12px", color: "#ccc", overflowY: "auto", height: "100%", boxSizing: "border-box", background: "#1e1e1e" },
    sectionHead:{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px", marginTop: "14px" },
    heading:    { color: "#888", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold" },
    // VRM grid
    grid:       { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "4px" },
    tile:       { width: "72px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", padding: "6px 4px", background: "#2a2a2a", borderRadius: "4px", border: "1px solid #3a3a3a", userSelect: "none" },
    tileName:   { color: "#bbb", fontSize: "10px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "64px" },
    emptyNote:  { color: "#555", fontSize: "11px", marginBottom: "8px" },
    // Actor cards
    actorCard:  { background: "#242424", borderRadius: "4px", border: "1px solid #333", marginBottom: "5px", overflow: "hidden" },
    actorHeader:{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 8px", cursor: "pointer", background: "#2a2a2a" },
    actorArrow: { color: "#666", fontSize: "10px", width: "10px", flexShrink: 0 },
    actorId:    { color: "#ddd", fontWeight: "bold", fontSize: "11px", flexShrink: 0 },
    actorModel: { color: "#777", fontSize: "11px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    clipBadge:  { background: "#333", borderRadius: "3px", padding: "1px 6px", color: "#9c9", fontSize: "10px", flexShrink: 0, maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    actorDetail:{ padding: "8px", display: "flex", flexDirection: "column", gap: "5px" },
    // VRMA browser
    searchRow:  { display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" },
    searchInput:{ flex: 1, background: "#2d2d2d", border: "1px solid #555", color: "#eee", padding: "3px 7px", borderRadius: "3px", fontSize: "12px", outline: "none" },
    catHeader:  { display: "flex", alignItems: "center", gap: "5px", padding: "3px 4px", cursor: "pointer", borderRadius: "3px", background: "#252525", marginBottom: "2px" },
    catArrow:   { color: "#666", fontSize: "10px", width: "10px" },
    catLabel:   { color: "#999", fontSize: "11px", flex: 1 },
    catCount:   { color: "#555", fontSize: "10px" },
    clipRow:    { display: "flex", alignItems: "center", gap: "4px", padding: "1px 4px 1px 20px" },
    clipName:   { color: "#aaa", fontSize: "11px", flex: 1, cursor: "pointer" },
    clipLocal:  { color: "#5a9f7a", fontSize: "9px", flexShrink: 0 },
    // Form widgets
    row:        { display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" },
    label:      { color: "#666", fontSize: "11px", flexShrink: 0 },
    input:      { background: "#333", border: "1px solid #555", color: "#eee", padding: "2px 6px", borderRadius: "3px", fontSize: "12px" },
    numInput:   { background: "#333", border: "1px solid #555", color: "#eee", padding: "2px 4px", borderRadius: "3px", fontSize: "12px", width: "50px" },
    select:     { background: "#333", border: "1px solid #555", color: "#eee", padding: "2px 4px", borderRadius: "3px", fontSize: "12px", maxWidth: "160px" },
    // Buttons
    btn:        { background: "#3a3a3a", border: "1px solid #555", color: "#ddd", padding: "2px 9px", borderRadius: "3px", cursor: "pointer", fontSize: "12px" },
    btnPrimary: { background: "#005fa3", border: "1px solid #0080d0", color: "#fff", padding: "3px 12px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: "bold" },
    btnSuccess: { background: "#1a5c2a", border: "1px solid #2a8c3a", color: "#7f7", padding: "2px 9px", borderRadius: "3px", cursor: "pointer", fontSize: "12px" },
    btnDanger:  { background: "transparent", border: "1px solid #633", color: "#f66", padding: "2px 7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px" },
    btnLoad:    { background: "#2a3a4a", border: "1px solid #3a6090", color: "#7af", padding: "2px 9px", borderRadius: "3px", cursor: "pointer", fontSize: "12px" },
    btnGhost:   { background: "transparent", border: "none", color: "#9c9", padding: "1px 5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px" },
    btnAudition:{ background: "transparent", border: "1px solid #3a3a3a", color: "#888", padding: "1px 5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px" },
    // Events
    eventRow:   { background: "#252525", borderRadius: "3px", padding: "5px 7px", marginBottom: "4px", display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" },
    // Footer
    footer:     { color: "#444", fontSize: "11px", borderTop: "1px solid #2a2a2a", paddingTop: "8px", marginTop: "14px" },
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const targetActor = actors.find(a => a.id === vrmaTarget);
  const totalVrmas  = allVrmaEntries.length;

  return (
    <div style={S.panel}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#fff", fontWeight: "bold", fontSize: "13px" }}>VRM Cast</span>
        <button style={S.btn} onClick={scanFiles} title="Re-scan files">↺ Scan</button>
      </div>

      {/* ══ Section 1: VRM Models grid ══ */}
      <div style={S.sectionHead}>
        <span style={S.heading}>VRM Models</span>
        <div style={{ display: "flex", gap: "5px" }}>
          <input ref={vrmFileInputRef} type="file" accept=".vrm"
            style={{ display: "none" }} onChange={handleVrmImport} />
          <button style={S.btn} onClick={() => vrmFileInputRef.current?.click()}>Import…</button>
        </div>
      </div>

      {vrmFiles.length === 0
        ? <div style={S.emptyNote}>No .vrm files in public/models/ — click Import or ↺ Scan.</div>
        : (
          <div style={S.grid}>
            {vrmFiles.map(f => (
              <div key={f} style={S.tile}
                onClick={() => addActorFromVrm(f)}
                title={`Add ${stem(f)} as actor`}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "#5a9f7a")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#3a3a3a")}
              >
                <PersonIcon />
                <span style={S.tileName}>{stem(f)}</span>
              </div>
            ))}
          </div>
        )
      }

      {/* ══ Section 2: Scene Cast ══ */}
      <div style={S.sectionHead}>
        <span style={S.heading}>Scene Cast</span>
        <span style={{ color: "#555", fontSize: "11px" }}>click a model tile to add</span>
      </div>

      {actors.length === 0 && (
        <div style={S.emptyNote}>No actors — click a VRM tile above.</div>
      )}

      {actors.map((actor, i) => {
        const isExpanded = expanded.has(i);
        const isLoaded   = loadedIds.has(actor.id);
        const isLoading  = loadedIds.has(`__loading__${actor.id}`);
        return (
          <div key={i} style={S.actorCard}>
            {/* ─ Collapsed header ─ */}
            <div style={S.actorHeader} onClick={() => toggleExpand(i)}>
              <span style={S.actorArrow}>{isExpanded ? "▾" : "▸"}</span>
              <span style={S.actorId}>{actor.id}</span>
              <span style={S.actorModel}>{stem(actor.vrm)}</span>
              {actor.initialClip && (
                <span style={S.clipBadge} title={actor.initialClip}>{stem(actor.initialClip)}</span>
              )}
              <button
                style={isLoaded ? S.btnSuccess : S.btnLoad}
                title={isLoaded ? "Unload from scene" : "Load into scene"}
                onClick={e => { e.stopPropagation(); isLoaded ? unloadActorFromScene(actor.id) : loadActorInScene(i); }}
                disabled={isLoading}
              >{isLoading ? "…" : isLoaded ? "⏹" : "↓"}</button>
              <button style={S.btnDanger} onClick={e => { e.stopPropagation(); removeActor(i); }}>×</button>
            </div>

            {/* ─ Expanded detail ─ */}
            {isExpanded && (
              <div style={S.actorDetail}>
                <div style={S.row}>
                  <span style={S.label}>id</span>
                  <input style={{ ...S.input, width: "72px" }} value={actor.id}
                    onChange={e => patchActor(i, { id: e.target.value })} />
                </div>
                <div style={S.row}>
                  <span style={S.label}>pos</span>
                  {(["x","y","z"] as const).map(ax => (
                    <input key={ax} style={S.numInput} type="number" step="0.1"
                      value={actor[ax]} onChange={e => patchActor(i, { [ax]: parseFloat(e.target.value)||0 })}
                      placeholder={ax} />
                  ))}
                  <span style={S.label}>rotY°</span>
                  <input style={S.numInput} type="number" step="5" value={actor.rotY}
                    onChange={e => patchActor(i, { rotY: parseFloat(e.target.value)||0 })} />
                </div>
                {/* Assigned clip (read-only; set via VRMA browser below) */}
                <div style={S.row}>
                  <span style={S.label}>clip</span>
                  {actor.initialClip
                    ? <>
                        <span style={{ ...S.clipBadge, maxWidth: "140px" }} title={actor.initialClip}>
                          {basename(actor.initialClip)}
                        </span>
                        <label style={{ ...S.label, display:"flex", alignItems:"center", gap:"4px", cursor:"pointer" }}>
                          <input type="checkbox" checked={actor.loop}
                            onChange={e => patchActor(i, { loop: e.target.checked })} />
                          loop
                        </label>
                        {isLoaded && (
                          <button style={S.btnSuccess} title="Replay this clip"
                            onClick={() => playInScene(actor.id, actor.initialClip, actor.loop)}>▶</button>
                        )}
                        <button style={S.btnDanger} title="Clear clip"
                          onClick={() => patchActor(i, { initialClip: "" })}>×</button>
                      </>
                    : <span style={{ color: "#555", fontSize: "11px" }}>
                        — assign from VRMA Library below —
                      </span>
                  }
                </div>
                {/* Load / Unload */}
                <div style={S.row}>
                  {isLoaded
                    ? <button style={S.btnDanger} onClick={() => unloadActorFromScene(actor.id)}>⏹ Unload</button>
                    : <button style={S.btnLoad} onClick={() => loadActorInScene(i)} disabled={isLoading}>
                        {isLoading ? "Loading…" : "↓ Load into scene"}
                      </button>
                  }
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ══ Section 3: VRMA Library ══ */}
      <div style={S.sectionHead}>
        <span style={S.heading}>VRMA Library</span>
        <span style={{ color: "#555", fontSize: "10px" }}>{totalVrmas} clips</span>
      </div>

      {/* Assign-to selector + search */}
      <div style={S.searchRow}>
        <span style={S.label}>→</span>
        {actors.length === 0
          ? <span style={{ color: "#555", fontSize: "11px" }}>add an actor first</span>
          : <select style={{ ...S.select, flex: 1 }} value={vrmaTarget}
              onChange={e => setVrmaTarget(e.target.value)}
              title="Assign clips to this actor">
              {actors.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
            </select>
        }
        <input
          style={S.searchInput}
          placeholder="Search clips…"
          value={vrmaSearch}
          onChange={e => setVrmaSearch(e.target.value)}
        />
        {vrmaSearch && (
          <button style={S.btnGhost} onClick={() => setVrmaSearch("")}>×</button>
        )}
      </div>

      {totalVrmas === 0 && (
        <div style={S.emptyNote}>No VRMA files found — run ↺ Scan with vrma/ library present.</div>
      )}

      {/* Category groups */}
      <div style={{ maxHeight: "280px", overflowY: "auto", marginBottom: "4px" }}>
        {[...filteredGroups.entries()].map(([cat, entries]) => {
          const isCatExpanded = expandedCats.has(cat);
          return (
            <div key={cat}>
              <div style={S.catHeader}
                onClick={() => setExpandedCats(prev => {
                  const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n;
                })}
              >
                <span style={S.catArrow}>{isCatExpanded ? "▾" : "▸"}</span>
                <span style={S.catLabel}>{cat}</span>
                <span style={S.catCount}>{entries.length}</span>
              </div>

              {isCatExpanded && entries.map(entry => (
                <div key={entry.name} style={S.clipRow}>
                  {/* Clip name → assign */}
                  <span
                    style={{
                      ...S.clipName,
                      color: entry.local ? "#9c9" : "#aaa",
                    }}
                    title={entry.local ? "In public/vrma/ (click to assign)" : "In library (click to assign + copy)"}
                    onClick={() => { if (vrmaTarget) assignClip(vrmaTarget, entry); }}
                  >
                    {entry.name}
                  </span>
                  {entry.local && <span style={S.clipLocal}>●</span>}
                  {/* ▶ audition */}
                  <button
                    style={S.btnAudition}
                    title={`Audition ${entry.name} on ${vrmaTarget || "selected actor"}`}
                    onClick={() => { if (vrmaTarget) auditionClip(vrmaTarget, entry); }}
                  >▶</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Assign / load error messages */}
      {assignMsg && <div style={{ color: "#9c9", fontSize: "11px", marginBottom: "4px" }}>{assignMsg}</div>}
      {loadErr   && <div style={{ color: "#f66", fontSize: "11px", marginBottom: "4px" }}>{loadErr}</div>}

      {/* ══ Section 4: Timeline Events ══ */}
      <div style={S.sectionHead}>
        <span style={S.heading}>Timeline Events</span>
        <button style={S.btn} onClick={addEvent} disabled={actors.length === 0}>+ Add Event</button>
      </div>

      {events.length === 0 && (
        <div style={S.emptyNote}>Initial clips auto-added at t=0 on export.</div>
      )}

      {events.map((ev, i) => (
        <div key={i} style={S.eventRow}>
          <span style={S.label}>t=</span>
          <input style={{ ...S.numInput, width: "46px" }} type="number" step="0.5" min="0"
            value={ev.start} onChange={e => patchEvent(i, { start: parseFloat(e.target.value)||0 })} />
          <span style={S.label}>s</span>
          <select style={{ ...S.select, width: "76px" }} value={ev.actor}
            onChange={e => patchEvent(i, { actor: e.target.value })}>
            {actors.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
          <select style={{ ...S.select, width: "70px" }} value={ev.action}
            onChange={e => patchEvent(i, { action: e.target.value as "animate"|"stop" })}>
            <option value="animate">animate</option>
            <option value="stop">stop</option>
          </select>
          {ev.action === "animate" && <>
            <select style={S.select} value={ev.clip}
              onChange={e => patchEvent(i, { clip: e.target.value })}>
              {localVrmas.map(f => <option key={f} value={f}>{basename(f)}</option>)}
            </select>
            <label style={{ ...S.label, display:"flex", alignItems:"center", gap:"4px", cursor:"pointer" }}>
              <input type="checkbox" checked={ev.loop}
                onChange={e => patchEvent(i, { loop: e.target.checked })} />
              loop
            </label>
          </>}
          <button style={S.btnDanger} onClick={() => removeEvent(i)}>×</button>
        </div>
      ))}

      {/* ══ Export + status ══ */}
      <div style={{ marginTop: "14px", display: "flex", gap: "8px", alignItems: "center" }}>
        <button style={S.btnPrimary} onClick={exportCast} disabled={actors.length === 0}>
          Export cast.json
        </button>
        {status && (
          <span style={{ color: status.ok ? "#4c9" : "#f66", fontSize: "11px" }}>
            {status.ok ? "✓ " : "✗ "}{status.msg}
          </span>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={S.footer}>
        {vrmFiles.length} VRM · {totalVrmas} VRMA ({allVrmaEntries.filter(e=>e.local).length} local) · {actors.length} actors · {events.length} events
      </div>

    </div>
  );
}
