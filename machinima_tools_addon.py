bl_info = {
    "name": "Machinima Director Tools",
    "author": "Gemini CLI",
    "version": (1, 4),
    "blender": (3, 6, 0),
    "location": "View3D > N-Panel > Machinima Tools",
    "description": "Full JSON Timeline Sync with Triple-Layer (Root/Body/Face) VRMA export.",
    "category": "Animation",
}

import bpy
import json
import os
from mathutils import Vector, Euler

# -------------------------------------------------------------------
# Properties
# -------------------------------------------------------------------

class MachinimaProperties(bpy.types.PropertyGroup):
    json_path: bpy.props.StringProperty(
        name="Director Script",
        description="Path to the main scene JSON file",
        default="",
        subtype='FILE_PATH'
    )
    target_armature: bpy.props.PointerProperty(
        name="Character",
        type=bpy.types.Object,
        poll=lambda self, obj: obj.type == 'ARMATURE'
    )

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def get_actor_by_id(actor_id):
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE' and obj.get("machinima_id") == actor_id:
            return obj
    return None

def get_mesh_with_shapekeys(armature):
    if not armature: return None
    for child in armature.children:
        if child.type == 'MESH' and child.data.shape_keys:
            return child
    return None

def ensure_nla_track(obj, track_name):
    if not obj.animation_data:
        obj.animation_data_create()
    
    for track in obj.animation_data.nla_tracks:
        if track.name == track_name:
            return track
    return obj.animation_data.nla_tracks.new()

def create_marker(name, position, rotation):
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = 'ARROWS'
    empty.empty_display_size = 0.5
    bpy.context.collection.objects.link(empty)
    empty.location = position
    empty.rotation_euler = rotation
    return empty

def isolate_action(obj, mode='BODY'):
    if not obj or not obj.animation_data or not obj.animation_data.action:
        return None
    
    original_action = obj.animation_data.action
    new_action = original_action.copy()
    new_action.name = f"{original_action.name}_{mode}"
    
    fcurves = new_action.fcurves
    to_remove = []
    
    for fc in fcurves:
        path = fc.data_path
        is_hips = 'pose.bones["Hips"]' in path or 'pose.bones["hips"]' in path
        is_bone = path.startswith('pose.bones')
        is_shape_key = "key_blocks" in path
        is_vrm_expr = "vrm" in path.lower() and "weight" in path.lower()
        is_custom_prop = path.startswith('["')
        is_facial = is_shape_key or is_vrm_expr or is_custom_prop

        if mode == 'ROOT':
            if not is_hips or is_facial: to_remove.append(fc)
        elif mode == 'BODY':
            if (is_hips and "location" in path) or is_facial: to_remove.append(fc)
        elif mode == 'FACE':
            if is_bone or not is_facial: to_remove.append(fc)
                
    for fc in to_remove:
        fcurves.remove(fc)
        
    if len(new_action.fcurves) == 0:
        bpy.data.actions.remove(new_action)
        return None
    return new_action

def import_vrma_as_action(filepath):
    """Imports a VRMA/GLB and returns the Action, then cleans up."""
    if not os.path.exists(filepath): return None
    
    # Track existing objects and actions to identify new ones
    pre_objs = set(bpy.data.objects.keys())
    pre_actions = set(bpy.data.actions.keys())
    
    try:
        bpy.ops.import_scene.gltf(filepath=filepath)
    except:
        return None
        
    new_action = None
    imported_objs = [bpy.data.objects[name] for name in bpy.data.objects.keys() if name not in pre_objs]
    
    for obj in imported_objs:
        if obj.type == 'ARMATURE' and obj.animation_data and obj.animation_data.action:
            new_action = obj.animation_data.action
            # Unlink from armature so it doesn't get deleted with the object
            obj.animation_data.action = None
            break
            
    for obj in imported_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
        
    return new_action

# -------------------------------------------------------------------
# Operators
# -------------------------------------------------------------------

class MACHINIMA_OT_SyncImport(bpy.types.Operator):
    """Import entire JSON timeline into NLA and VSE"""
    bl_idname = "machinima.sync_import"
    bl_label = "Sync JSON to Timeline"

    def execute(self, context):
        props = context.scene.machinima_tools
        if not os.path.exists(props.json_path):
            self.report({'ERROR'}, "Invalid JSON path")
            return {'CANCELLED'}
        
        with open(props.json_path, 'r') as f:
            data = json.load(f)

        base_dir = os.path.dirname(props.json_path)
        fps = context.scene.render.fps / context.scene.render.fps_base

        # 1. Setup Actors
        for actor_data in data.get("actors", []):
            actor_id = actor_data["id"]
            armature = get_actor_by_id(actor_id)
            if not armature:
                vrm_path = actor_data.get("vrm")
                if vrm_path:
                    full_vrm_path = os.path.join(base_dir, vrm_path)
                    if os.path.exists(full_vrm_path):
                        bpy.ops.import_scene.vrm(filepath=full_vrm_path)
                        armature = context.active_object
                        armature["machinima_id"] = actor_id
                        armature.name = f"Actor_{actor_id}"
            
            if armature:
                pos = actor_data.get("startPosition", {"x":0,"y":0,"z":0})
                armature.location = (pos["x"], pos["z"], pos["y"])

        # 2. Clear existing NLA for managed actors
        for obj in bpy.data.objects:
            if obj.get("machinima_id") and obj.animation_data:
                for track in list(obj.animation_data.nla_tracks):
                    obj.animation_data.nla_tracks.remove(track)

        # 3. Populate Timeline
        timeline = data.get("timeline", [])
        if not context.scene.sequence_editor: context.scene.sequence_editor_create()
        # Clear existing audio
        for seq in list(context.scene.sequence_editor.sequences):
            if seq.name.startswith("Audio_"):
                context.scene.sequence_editor.sequences.remove(seq)

        for i, event in enumerate(timeline):
            actor_id = event.get("actor")
            armature = get_actor_by_id(actor_id)
            start_frame = event.get("start", 0) * fps
            
            audio_path = event.get("audio")
            if audio_path:
                full_audio_path = os.path.join(base_dir, audio_path)
                if os.path.exists(full_audio_path):
                    context.scene.sequence_editor.sequences.new_sound(
                        name=f"Audio_{i}", 
                        filepath=full_audio_path, 
                        channel=i+1, 
                        frame_start=int(start_frame)
                    )

            layers = event.get("layers", {})
            clip_path = event.get("clip")
            
            if layers:
                for layer_name, sub_clip in layers.items():
                    full_clip_path = os.path.join(base_dir, "vrma", sub_clip)
                    if not os.path.exists(full_clip_path):
                        full_clip_path = os.path.join(base_dir, sub_clip)
                    
                    action = import_vrma_as_action(full_clip_path)
                    if action and armature:
                        track = ensure_nla_track(armature, layer_name.upper())
                        strip = track.strips.new(event.get("description", f"Event_{i}"), int(start_frame), action)
                        strip.name = f"EVT_{i}_{layer_name}"
            elif clip_path:
                full_clip_path = os.path.join(base_dir, clip_path)
                action = import_vrma_as_action(full_clip_path)
                if action and armature:
                    track = ensure_nla_track(armature, "BODY")
                    strip = track.strips.new(event.get("description", f"Event_{i}"), int(start_frame), action)
                    strip.name = f"EVT_{i}"

        return {'FINISHED'}

class MACHINIMA_OT_SyncExport(bpy.types.Operator):
    """Update JSON timeline based on Blender NLA/VSE positions"""
    bl_idname = "machinima.sync_export"
    bl_label = "Update JSON from Timeline"

    def execute(self, context):
        props = context.scene.machinima_tools
        if not os.path.exists(props.json_path): return {'CANCELLED'}
        
        with open(props.json_path, 'r') as f:
            data = json.load(f)

        fps = context.scene.render.fps / context.scene.render.fps_base
        timeline = data.get("timeline", [])

        for i, event in enumerate(timeline):
            audio_name = f"Audio_{i}"
            if context.scene.sequence_editor:
                snd = context.scene.sequence_editor.sequences.get(audio_name)
                if snd:
                    event["start"] = round(snd.frame_start / fps, 3)

            actor_id = event.get("actor")
            armature = get_actor_by_id(actor_id)
            if armature and armature.animation_data:
                found_start = None
                for track in armature.animation_data.nla_tracks:
                    for strip in track.strips:
                        if strip.name.startswith(f"EVT_{i}"):
                            found_start = strip.frame_start
                            event["duration"] = round((strip.frame_end - strip.frame_start) / fps, 3)
                            break
                if found_start is not None:
                    event["start"] = round(found_start / fps, 3)

        with open(props.json_path, 'w') as f:
            json.dump(data, f, indent=2)

        self.report({'INFO'}, "JSON Timeline Updated")
        return {'FINISHED'}

class MACHINIMA_OT_ExportLayered(bpy.types.Operator):
    """Export synchronized Root, Body, and Face VRMAs"""
    bl_idname = "machinima.export_layered"
    bl_label = "Export Layered VRMAs"

    def execute(self, context):
        props = context.scene.machinima_tools
        armature = props.target_armature
        if not armature: 
            self.report({'ERROR'}, "No target armature selected")
            return {'CANCELLED'}
        
        mesh = get_mesh_with_shapekeys(armature)
        base_path = props.json_path.replace(".json", "")
        
        layers_to_export = {
            "root": f"{base_path}_root.vrma",
            "body": f"{base_path}_body.vrma",
            "face": f"{base_path}_face.vrma"
        }
        
        original_arm_action = armature.animation_data.action if armature.animation_data else None
        original_mesh_action = mesh.animation_data.action if mesh and mesh.animation_data else None
        original_matrix = armature.matrix_world.copy()

        original_active = context.view_layer.objects.active
        original_selection = context.selected_objects[:]

        try:
            armature.location = (0, 0, 0)
            armature.rotation_euler = (0, 0, 0)
            
            bpy.ops.object.select_all(action='DESELECT')
            armature.select_set(True)
            if mesh: mesh.select_set(True)
            context.view_layer.objects.active = armature

            for layer_name, filepath in layers_to_export.items():
                mode = layer_name.upper()
                tmp_arm_action = isolate_action(armature, mode)
                armature.animation_data.action = tmp_arm_action
                
                tmp_mesh_action = None
                if mesh:
                    tmp_mesh_action = isolate_action(mesh, mode)
                    if mesh.animation_data:
                        mesh.animation_data.action = tmp_mesh_action

                if hasattr(bpy.ops, "vrm") and hasattr(bpy.ops.vrm, "export_vrma"):
                    bpy.ops.vrm.export_vrma(filepath=filepath)
                else:
                    bpy.ops.export_scene.gltf(filepath=filepath, export_format='GLB', use_selection=True)

                if tmp_arm_action: bpy.data.actions.remove(tmp_arm_action)
                if tmp_mesh_action: bpy.data.actions.remove(tmp_mesh_action)

            self.report({'INFO'}, "Triple-Layer Export Complete")

        finally:
            if armature.animation_data: armature.animation_data.action = original_arm_action
            if mesh and mesh.animation_data: mesh.animation_data.action = original_mesh_action
            armature.matrix_world = original_matrix
            
            bpy.ops.object.select_all(action='DESELECT')
            for obj in original_selection: obj.select_set(True)
            context.view_layer.objects.active = original_active

        return {'FINISHED'}

# -------------------------------------------------------------------
# UI Panel
# -------------------------------------------------------------------

class MACHINIMA_PT_Panel(bpy.types.Panel):
    bl_label = "Machinima Tools"
    bl_idname = "MACHINIMA_PT_Panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Machinima Tools'

    def draw(self, context):
        layout = self.layout
        props = context.scene.machinima_tools
        col = layout.column(align=True)
        col.prop(props, "json_path")
        col.prop(props, "target_armature")
        
        layout.separator()
        layout.label(text="Timeline Sync:")
        row = layout.row(align=True)
        row.operator("machinima.sync_import", icon='IMPORT', text="Import JSON")
        row.operator("machinima.sync_export", icon='EXPORT', text="Update JSON")
        
        layout.separator()
        layout.label(text="Active Layer Export:")
        layout.operator("machinima.export_layered", icon='RENDER_ANIMATION', text="Export Root/Body/Face")

# -------------------------------------------------------------------
# Registration
# -------------------------------------------------------------------

classes = (
    MachinimaProperties, 
    MACHINIMA_OT_SyncImport, 
    MACHINIMA_OT_SyncExport, 
    MACHINIMA_OT_ExportLayered,
    MACHINIMA_PT_Panel
)

def register():
    for cls in classes: bpy.utils.register_class(cls)
    bpy.types.Scene.machinima_tools = bpy.props.PointerProperty(type=MachinimaProperties)

def unregister():
    for cls in reversed(classes): bpy.utils.unregister_class(cls)
    del bpy.types.Scene.machinima_tools

if __name__ == "__main__":
    register()
