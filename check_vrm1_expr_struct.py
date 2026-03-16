import bpy
import sys

def check_expr_struct(filepath):
    try:
        bpy.ops.import_scene.vrm(filepath=filepath)
    except:
        return
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    ext = arm.data.vrm_addon_extension
    ext.spec_version = '1.0'
    exprs = ext.vrm1.expressions
    print("Expressions-attributes:")
    for a in sorted([a for a in dir(exprs) if not a.startswith('_')]):
        print("  " + str(a))
    
    # Check custom expressions list
    print("Custom-expressions-type: " + str(type(exprs.custom)))
    print("Custom-expressions-attrs: " + str([a for a in dir(exprs.custom) if not a.startswith('_')]))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        check_expr_struct(sys.argv[-1])
