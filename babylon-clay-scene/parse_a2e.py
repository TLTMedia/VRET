import json
import re

"""
Parses the JSON output of LAM-A2E (Audio2Expression) into the format used by the A2FAvatar scene manifest.
A2E by default outputs the following 52 shapes.
"""
LAM_A2E_SHAPES = [
    "eyeBlink_L", "eyeLookDown_L", "eyeLookIn_L", "eyeLookOut_L", "eyeLookUp_L",
    "eyeSquint_L", "eyeWide_L", "eyeBlink_R", "eyeLookDown_R", "eyeLookIn_R",
    "eyeLookOut_R", "eyeLookUp_R", "eyeSquint_R", "eyeWide_R", "jawForward",
    "jawLeft", "jawRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker",
    "mouthLeft", "mouthRight", "mouthSmile_L", "mouthSmile_R", "mouthFrown_L",
    "mouthFrown_R", "mouthDimple_L", "mouthDimple_R", "mouthStretch_L",
    "mouthStretch_R", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
    "mouthShrugUpper", "mouthPress_L", "mouthPress_R", "mouthLowerDown_L",
    "mouthLowerDown_R", "mouthUpperUp_L", "mouthUpperUp_R", "browDown_L",
    "browDown_R", "browInnerUp", "browOuterUp_L", "browOuterUp_R", "cheekPuff",
    "cheekSquint_L", "cheekSquint_R", "noseSneer_L", "noseSneer_R", "tongueOut"
]

def arkit_to_model_name(name: str) -> str:
    """Convert ARKit _L/_R convention to your model's CapitalizedLeft/Right format."""
    name = re.sub(r'_L$', 'Left', name)
    name = re.sub(r'_R$', 'Right', name)
    return name[0].upper() + name[1:]  # capitalize first letter only

# Pre-build the target shape name list
MODEL_SHAPES = [arkit_to_model_name(s) for s in LAM_A2E_SHAPES]

def convert_lam_to_model_format(lam_data: dict) -> dict:
    """
    Convert LAM-A2E output to A2FAvatar JSON format.
    
    LAM-A2E output is expected as:
      { "fps": 30, "frames": [ {"time": ..., "weights": [52 values]}, ... ] }
    """
    out_frames = []
    for i, frame in enumerate(lam_data["frames"]):
        out_frames.append({
            "time": frame["time"],
            "weights": frame["weights"]  # already ordered to match MODEL_SHAPES
        })

    return {
        "fps": lam_data.get("fps", 30),
        "frameCount": len(out_frames),
        "blendShapeNames": MODEL_SHAPES,
        "frames": out_frames
    }


if __name__ == "__main__":
    with open("lam_a2e_output.json") as f:
        lam_data = json.load(f)

    result = convert_lam_to_model_format(lam_data)

    with open("model_animation.json", "w") as f:
        json.dump(result, f, indent=2)

    print("Converted shape names:")
    for arkit, model in zip(LAM_A2E_SHAPES, MODEL_SHAPES):
        print(f"  {arkit:25s} -> {model}")