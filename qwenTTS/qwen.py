import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel
import json



model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    device_map="cpu",
    dtype=torch.float32,
    attn_implementation="sdpa",
)




ref_audio = "cloneWav/LetitiaCrop.wav"
ref_text  = "I identify myself as a child of God and I can't get up here without thinking God but I just wanna I just wanna encourage you anybody that's going through a hard time or something thinking their soul or that they've lost their light I wanna encourage you that God made you and you're important"


prompt_items_Letitia = model.create_voice_clone_prompt(
    ref_audio=ref_audio,
    ref_text=ref_text,
    x_vector_only_mode=True,
)



ref_audio = "cloneWav/CoryxKenshinClip.wav"
ref_text  = "OK so you gonna go that way now run time itself I'm here for the cheeks let me be black I ain't dark chocolate wanted to put a spotlight on our brother was running"


prompt_items_Cory = model.create_voice_clone_prompt(
    ref_audio=ref_audio,
    ref_text=ref_text,
    x_vector_only_mode=True,
)










with open("./traffic.json", "r") as f:
   file_contents = f.read()
# The file is automatically closed outside of the 'with' block
dialogue = json.loads(file_contents)


script = dialogue["script"]





# single inference


# batch inference
# 4. Run TTS
# Ensure the path to 'Letitia.wav' is correct relative to where you run the script
map={"Officer Miller":prompt_items_Cory, "Jordan":prompt_items_Letitia}

for i in range(len(script)):
    char_name = script[i]["character"]
    character = map[char_name]
    line = script[i]["line"]
    
    # Safety check: Do not have CoryxKenshin say caramel Machiatto
    if char_name == "Officer Miller":
        line = line.replace("caramel Machiatto", "").replace("Caramel Machiatto", "")
        
    char_desc = dialogue["characters"].get(char_name, "")
    exposition = script[i].get("exposition", "Natural speech.")
    
    # Ensure sentence ending is clear by adding punctuation if missing
    if not line.endswith(('.', '!', '?')):
        line += "."

    # Construct a detailed instruction for proper emotions and pauses
    instruction = (
        f"Character: {char_desc} "
        f"Context: {exposition} "
        "Deliver the line with high quality, proper emotional expression, and natural pauses. "
        "Ensure the end of the sentence is clearly articulated and final."
    )

    wavs,sr = model.generate_voice_clone(
        text=line,
        language="English",
        voice_clone_prompt=character,
        instruct=instruction
    )
    sf.write(f"output_custom_voice_{i}.wav", wavs[0], sr)
