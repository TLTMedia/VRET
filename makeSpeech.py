from TTS.api import TTS
import os

# Initialize TTS with a default model
tts = TTS(model_name="tts_models/en/ljspeech/glow-tts", progress_bar=False)

# Text to speak
text = "Hello! This is a test of the Coqui text to speech system."

# Output path
output_path = "output_speech.wav"

# Generate speech
tts.tts_to_file(text=text, file_path=output_path)
print(f"Speech saved to {output_path}")
