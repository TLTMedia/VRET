#!/usr/bin/env python3
# YOU NEED a2f_config.json TO RUN THIS:
# {
#   "nvidia_api_key": "YOUR KEY",
#   "function_id": "8efc55f5-6f00-424e-afe9-26212cd2c630",
#   "endpoint": "grpc.nvcf.nvidia.com:443"
# }

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
import time
import wave
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple


@dataclasses.dataclass(frozen=True)
class A2FFrame:
    time_seconds: float
    weights: Dict[str, float]


@dataclasses.dataclass
class DiagnosticStats:
    """Statistics collected during extraction"""
    frame_count: int = 0
    raw_frame_count: int = 0
    api_response_count: int = 0
    response_ok: bool = True
    error_msg: Optional[str] = None
    blendshape_stats: Dict[str, Tuple[float, float, float]] = dataclasses.field(default_factory=dict)
    has_tongue: Optional[bool] = None
    audio_duration_seconds: Optional[float] = None


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)


def _apply_gains(
    weights: Dict[str, float],
    global_gain: float = 1.0,
    jaw_gain: float = 1.0,
    lip_gain: float = 1.0,
    tongue_gain: float = 1.0,
    silence_gate: float = 0.0,
) -> Dict[str, float]:
    """Apply calibration gains to weights."""
    result = {}
    
    jaw_keys = {"jawOpen", "jawLeft", "jawRight", "jawForward"}
    lip_keys = {
        "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
        "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower",
        "mouthClose", "mouthUpperUpLeft", "mouthUpperUpRight",
        "mouthUpperDeepenLeft", "mouthUpperDeepenRight",
        "mouthLowerDownLeft", "mouthLowerDownRight",
        "mouthPressLeft", "mouthPressRight",
        "mouthStretchLeft", "mouthStretchRight",
        "mouthDimpleLeft", "mouthDimpleRight",
        "mouthTightenerLeft", "mouthTightenerRight",
        "mouthCornerPullLeft", "mouthCornerPullRight",
        "mouthCornerDepressLeft", "mouthCornerDepressRight",
    }
    tongue_keys = {"tongueOut", "tongueTwistLeft", "tongueTwistRight"}
    
    for k, v in weights.items():
        gain = global_gain
        
        # if k in jaw_keys:
        #     gain *= jaw_gain
        if k in lip_keys:
            gain *= lip_gain
        if k in tongue_keys:
            gain *= tongue_gain
        
        val = v * gain

        # Jaw(턱) 전용 비선형 로직 적용
        if k in jaw_keys:
            # jaw_gain이 1보다 클 때만 가속 효과 적용
            if jaw_gain > 1.0:
                # v^1.5 정도의 곡선을 그려서 작은 값은 작게, 큰 값은 더 크게 만듭니다.
                # 그 후 jaw_gain을 곱하여 최종 범위를 조절합니다.
                val = (v ** 1.5) * jaw_gain * global_gain
            else:
                val = v * jaw_gain * global_gain

        if val < silence_gate:
            val = 0.0
        
        result[k] = _clamp01(val)
    
    return result


def read_wav_16bit_pcm(wav_path: Path) -> Tuple[bytes, int, int, int]:
    """Return (pcm_bytes, sample_rate, num_channels, num_frames)."""
    if not wav_path.exists():
        raise FileNotFoundError(f"WAV not found: {wav_path}")

    with wave.open(str(wav_path), "rb") as wf:
        comp_type = wf.getcomptype()
        if comp_type != "NONE":
            raise ValueError(
                f"WAV must be uncompressed PCM (comptype=NONE). Got: {comp_type}"
            )

        sample_width = wf.getsampwidth()
        if sample_width != 2:
            raise ValueError(
                f"WAV must be 16-bit PCM (sample_width=2). Got: {sample_width} bytes"
            )

        num_channels = wf.getnchannels()
        sample_rate = wf.getframerate()
        num_frames = wf.getnframes()
        pcm_bytes = wf.readframes(num_frames)

    return pcm_bytes, sample_rate, num_channels, num_frames


def compute_stats(frames: Sequence[A2FFrame]) -> Dict[str, Tuple[float, float, float]]:
    """Return {name: (min, max, mean)} for each blendshape."""
    if not frames:
        return {}
    
    stats: Dict[str, List[float]] = {}
    for frame in frames:
        for k, v in frame.weights.items():
            if k not in stats:
                stats[k] = []
            stats[k].append(v)
    
    result = {}
    for k, values in stats.items():
        result[k] = (
            min(values),
            max(values),
            sum(values) / len(values),
        )
    return result


def smooth_frames(frames: Sequence[A2FFrame], window_size: int) -> List[A2FFrame]:
    """Apply moving average smoothing."""
    if window_size <= 1 or not frames:
        return list(frames)
    
    all_keys = sorted({k for f in frames for k in f.weights.keys()})
    data: Dict[str, List[float]] = {k: [] for k in all_keys}
    times = []
    
    for frame in frames:
        times.append(frame.time_seconds)
        for k in all_keys:
            data[k].append(frame.weights.get(k, 0.0))
    
    window = window_size
    smoothed_data: Dict[str, List[float]] = {k: [] for k in all_keys}
    
    for i in range(len(frames)):
        start = max(0, i - window // 2)
        end = min(len(frames), i + window // 2 + 1)
        
        for k in all_keys:
            values = data[k][start:end]
            smoothed_data[k].append(sum(values) / len(values))
    
    result = []
    for i, t in enumerate(times):
        weights = {k: _clamp01(smoothed_data[k][i]) for k in all_keys}
        result.append(A2FFrame(time_seconds=t, weights=weights))
    
    return result


def load_local_config(config_path: Path) -> dict:
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_api_key(cli_api_key: Optional[str], config: dict) -> str:
    if cli_api_key:
        return cli_api_key

    env_key = os.environ.get("NVIDIA_API_KEY")
    if env_key:
        return env_key

    cfg_key = config.get("nvidia_api_key")
    if cfg_key:
        return cfg_key

    raise RuntimeError(
        "Missing NVIDIA API key. Set NVIDIA_API_KEY env var or create a2f_config.json "
        "with {\"nvidia_api_key\": \"...\"}."
    )


def call_a2f_grpc(
    *,
    pcm_bytes: bytes,
    sample_rate: int,
    num_channels: int,
    api_key: str,
    config: dict,
    function_id: Optional[str] = None,
    diag: Optional[DiagnosticStats] = None,
) -> List[A2FFrame]:
    """Call NVIDIA Audio2Face Cloud gRPC API."""

    import asyncio
    try:
        import grpc
        from nvidia_ace.audio.v1_pb2 import AudioHeader
        from nvidia_ace.a2f.v1_pb2 import (
            AudioWithEmotion, EmotionPostProcessingParameters,
            FaceParameters, BlendShapeParameters
        )
        from nvidia_ace.controller.v1_pb2 import AudioStream, AudioStreamHeader
        from nvidia_ace.services.a2f_controller.v1_pb2_grpc import A2FControllerServiceStub
    except ImportError as e:
        raise ImportError(f"nvidia-ace dependencies missing: {e}")
    
    func_id = function_id or config.get("function_id")
    if not func_id:
        raise ValueError(
            "Missing NVIDIA Function ID. Use --function-id, set in a2f_config.json, or set env var."
        )
    
    endpoint = config.get("endpoint", "grpc.nvcf.nvidia.com:443")
    
    print(f"[A2F ACE] Connecting to {endpoint}")
    print(f"[A2F ACE] Function ID: {func_id}")
    print(f"[A2F ACE] Sending {len(pcm_bytes)} bytes of PCM audio")
    print(f"[A2F ACE] Sample rate: {sample_rate} Hz, Channels: {num_channels}")
    
    async def process_audio_async():
        frames = []
        response_count = 0
        
        def metadata_callback(context, callback):
            metadata = [("function-id", func_id), ("authorization", f"Bearer {api_key}")]
            callback(metadata, None)
        
        creds = grpc.ssl_channel_credentials()
        auth_creds = grpc.metadata_call_credentials(metadata_callback)
        composite_creds = grpc.composite_channel_credentials(creds, auth_creds)
        
        try:
            async with grpc.aio.secure_channel(endpoint, composite_creds) as channel:
                stub = A2FControllerServiceStub(channel)
                stream = stub.ProcessAudioStream()
                
                audio_header = AudioHeader(
                    samples_per_second=sample_rate,
                    bits_per_sample=16,
                    channel_count=num_channels,
                    audio_format=AudioHeader.AUDIO_FORMAT_PCM
                )
                
                audio_stream_header = AudioStream(
                    audio_stream_header=AudioStreamHeader(
                        audio_header=audio_header,
                        face_params=FaceParameters(float_params={}),
                        blendshape_params=BlendShapeParameters(
                            bs_weight_multipliers={},
                            bs_weight_offsets={}
                        ),
                        emotion_post_processing_params=EmotionPostProcessingParameters()
                    )
                )
                
                await stream.write(audio_stream_header)
                print("[A2F ACE] Sent audio stream header")
                
                chunk_size = sample_rate * num_channels * 2
                chunks_sent = 0
                for i in range(0, len(pcm_bytes), chunk_size):
                    chunk = pcm_bytes[i:i + chunk_size]
                    audio_stream = AudioStream(
                        audio_with_emotion=AudioWithEmotion(audio_buffer=chunk)
                    )
                    await stream.write(audio_stream)
                    chunks_sent += 1
                
                await stream.done_writing()
                print(f"[A2F ACE] Sent {chunks_sent} chunks ({len(pcm_bytes)} bytes total)")
                
                try:
                    async for message in stream:
                        response_count += 1
                        
                        if message.HasField("animation_data"):
                            anim_data = message.animation_data
                            
                            if anim_data.skel_animation and anim_data.skel_animation.blend_shape_weights:
                                for blend_weights_item in anim_data.skel_animation.blend_shape_weights:
                                    time_seconds = blend_weights_item.time_code
                                    values_array = blend_weights_item.values
                                    
                                    weights = {}
                                    arkit_names = [
                                        "jawOpen", "jawLeft", "jawRight", "jawForward",
                                        "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
                                        "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower",
                                        "mouthClose", "mouthUpperUpLeft", "mouthUpperUpRight",
                                        "mouthUpperDeepenLeft", "mouthUpperDeepenRight",
                                        "mouthLowerDownLeft", "mouthLowerDownRight",
                                        "mouthPressLeft", "mouthPressRight",
                                        "mouthStretchLeft", "mouthStretchRight",
                                        "mouthDimpleLeft", "mouthDimpleRight",
                                        "mouthTightenerLeft", "mouthTightenerRight",
                                        "mouthCornerPullLeft", "mouthCornerPullRight",
                                        "mouthCornerDepressLeft", "mouthCornerDepressRight",
                                        "eyeBlinkLeft", "eyeBlinkRight",
                                        "eyeLookDownLeft", "eyeLookDownRight",
                                        "eyeLookInLeft", "eyeLookInRight",
                                        "eyeLookOutLeft", "eyeLookOutRight",
                                        "eyeLookUpLeft", "eyeLookUpRight",
                                        "eyeWideLeft", "eyeWideRight",
                                        "eyeSquintLeft", "eyeSquintRight",
                                        "browDownLeft", "browDownRight", "browInnerUp",
                                        "browOuterUpLeft", "browOuterUpRight",
                                        "noseSneerLeft", "noseSneerRight",
                                        "cheekPuff", "cheekSquintLeft", "cheekSquintRight"
                                    ]
                                    
                                    if diag and diag.has_tongue is None:
                                        diag.has_tongue = len(values_array) > 52
                                    
                                    for idx, name in enumerate(arkit_names):
                                        if idx < len(values_array):
                                            weights[name] = float(values_array[idx])
                                        else:
                                            weights[name] = 0.0
                                    
                                    weights = {k: _clamp01(v) for k, v in weights.items()}
                                    frames.append(A2FFrame(time_seconds=round(time_seconds, 6), weights=weights))
                        
                except grpc.aio.AioRpcError as e:
                    if diag:
                        diag.error_msg = f"Stream error: {e.details()}"
                    print(f"[WARNING] Stream error: {e.details()}")
                
                if diag:
                    diag.api_response_count = response_count
                    diag.raw_frame_count = len(frames)
                print(f"[A2F ACE] Received {response_count} response messages, {len(frames)} animation frames")
        
        except Exception as e:
            if diag:
                diag.response_ok = False
                diag.error_msg = str(e)
            raise
        
        return frames
    
    try:
        frames = asyncio.run(process_audio_async())
        
        if len(frames) == 0:
            msg = "No frames received from A2F service. Check Function ID and API key."
            if diag:
                diag.response_ok = False
                diag.error_msg = msg
            raise RuntimeError(msg)
        
        if diag:
            diag.audio_duration_seconds = frames[-1].time_seconds if frames else None
        
        return frames
        
    except Exception as e:
        print(f"[ERROR] A2F ACE error: {e}")
        import traceback
        traceback.print_exc()
        if diag:
            diag.response_ok = False
            diag.error_msg = str(e)
        raise


def resample_frames_to_fps(frames: Sequence[A2FFrame], target_fps: float) -> List[A2FFrame]:
    if not frames:
        return []

    if target_fps <= 0:
        raise ValueError("target_fps must be > 0")

    times = [float(f.time_seconds) for f in frames]
    for i in range(1, len(times)):
        if times[i] < times[i - 1]:
            raise ValueError("Input frames must have non-decreasing time_seconds")

    dt = 1.0 / float(target_fps)
    t_end = times[-1]

    all_keys: List[str] = sorted({k for f in frames for k in f.weights.keys()})

    def weights_at(index: int, key: str) -> float:
        return float(frames[index].weights.get(key, 0.0))

    out: List[A2FFrame] = []

    i = 0
    t = 0.0
    while t <= t_end + 1e-9:
        while i + 1 < len(frames) and times[i + 1] < t:
            i += 1

        if i + 1 >= len(frames):
            w = {k: _clamp01(weights_at(len(frames) - 1, k)) for k in all_keys}
            out.append(A2FFrame(time_seconds=round(t, 6), weights=w))
            t += dt
            continue

        t0, t1 = times[i], times[i + 1]
        if t <= t0:
            w = {k: _clamp01(weights_at(i, k)) for k in all_keys}
            out.append(A2FFrame(time_seconds=round(t, 6), weights=w))
            t += dt
            continue

        denom = (t1 - t0)
        alpha = 0.0 if denom <= 1e-12 else (t - t0) / denom
        if alpha < 0.0:
            alpha = 0.0
        elif alpha > 1.0:
            alpha = 1.0

        w: Dict[str, float] = {}
        for k in all_keys:
            v0 = weights_at(i, k)
            v1 = weights_at(i + 1, k)
            v = v0 + (v1 - v0) * alpha
            w[k] = _clamp01(v)

        out.append(A2FFrame(time_seconds=round(t, 6), weights=w))
        t += dt

    return out


def write_timeseries_json(out_path: Path, fps: int, frames: Sequence[A2FFrame]) -> None:
    payload = {
        "fps": int(fps),
        "data": [
            {
                "time": float(f.time_seconds),
                "weights": {k: float(round(v, 6)) for k, v in f.weights.items()},
            }
            for f in frames
        ],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Extract NVIDIA Audio2Face blendshape weights via gRPC with diagnostics & calibration."
    )
    p.add_argument("--wav", required=True, type=Path, help="Input 16-bit PCM WAV")
    p.add_argument("--out", required=True, type=Path, help="Output JSON path")
    p.add_argument("--fps", type=int, default=60, help="Target FPS (default: 60)")
    p.add_argument("--api-key", type=str, default=None, help="Override API key")
    p.add_argument("--function-id", type=str, default=None, help="Override Function ID (for testing)")
    p.add_argument("--config", type=Path, default=Path("a2f_config.json"), help="Config JSON (default: a2f_config.json)")
    
    # Calibration flags
    p.add_argument("--global-gain", type=float, default=1.0, help="Global amplitude multiplier (default: 1.0)")
    p.add_argument("--jaw-gain", type=float, default=1.0, help="Jaw movements multiplier (default: 1.0)")
    p.add_argument("--lip-gain", type=float, default=1.0, help="Lip movements multiplier (default: 1.0)")
    p.add_argument("--tongue-gain", type=float, default=1.0, help="Tongue movements multiplier (default: 1.0)")
    p.add_argument("--smooth", type=int, default=1, help="Smoothing window size in frames (default: 1=none)")
    p.add_argument("--silence-gate", type=float, default=0.0, help="Silence gate threshold (default: 0.0)")
    
    # Diagnostics
    p.add_argument("--compare-all", action="store_true", help="Test all 6 function IDs and generate comparison report")
    p.add_argument("--verbose", action="store_true", help="Print per-frame statistics")
    
    return p


def print_diagnostics(diag: DiagnosticStats, frames_final: Optional[List[A2FFrame]] = None) -> None:
    """Print diagnostic summary."""
    print("\n" + "="*70)
    print("DIAGNOSTIC SUMMARY")
    print("="*70)
    print(f"API Response Status: {'OK' if diag.response_ok else 'FAILED'}")
    if diag.error_msg:
        print(f"  Error: {diag.error_msg}")
    print(f"API Response Messages: {diag.api_response_count}")
    print(f"Raw Frames (from API): {diag.raw_frame_count}")
    print(f"Resampled Frames: {diag.frame_count}")
    print(f"Audio Duration: {diag.audio_duration_seconds:.3f}s" if diag.audio_duration_seconds else "")
    print(f"Has Tongue Channels: {diag.has_tongue}")
    print()
    
    if frames_final and diag.blendshape_stats:
        # Count near-zero, zero, and saturated values
        near_zero_count = sum(1 for k, (mn, mx, mean) in diag.blendshape_stats.items() if mean < 0.01)
        saturated = sum(1 for k, (mn, mx, mean) in diag.blendshape_stats.items() if mx > 0.9)
        print(f"Blendshapes with near-zero mean: {near_zero_count}/{len(diag.blendshape_stats)}")
        print(f"Blendshapes reaching saturation (>0.9): {saturated}/{len(diag.blendshape_stats)}")
        print()
        print("Top 10 Most Active Blendshapes (by max value):")
        sorted_by_max = sorted(diag.blendshape_stats.items(), key=lambda x: x[1][1], reverse=True)
        for name, (mn, mx, mean) in sorted_by_max[:10]:
            print(f"  {name:30s}  min={mn:.3f}  max={mx:.3f}  mean={mean:.3f}")
    
    print("="*70 + "\n")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    config = load_local_config(args.config)
    api_key = resolve_api_key(args.api_key, config)

    # Load audio
    pcm_bytes, sample_rate, num_channels, _ = read_wav_16bit_pcm(args.wav)
    audio_duration = len(pcm_bytes) / (sample_rate * num_channels * 2)

    if args.compare_all:
        # Test all 6 function IDs
        print("\n" + "="*70)
        print("MULTI-FUNCTION ID COMPARISON")
        print("="*70)
        
        function_ids = {
            "Mark (tongue enabled)": "8efc55f5-6f00-424e-afe9-26212cd2c630",
            "Claire (tongue enabled)": "0961a6da-fb9e-4f2e-8491-247e5fd7bf8d",
            "James (tongue enabled)": "9327c39f-a361-4e02-bd72-e11b4c9b7b5e",
            "Mark (tongue disabled)": "cf145b84-423b-4222-bfdd-15bb0142b0fd",
            "Claire (tongue disabled)": "617f80a7-85e4-4bf0-9dd6-dcb61e886142",
            "James (tongue disabled)": "8082bdcb-9968-4dc5-8705-423ea98b8fc2",
        }
        
        comparison_results = []
        
        for name, func_id in function_ids.items():
            print(f"\nTesting: {name}")
            diag = DiagnosticStats()
            
            try:
                frames = call_a2f_grpc(
                    pcm_bytes=pcm_bytes,
                    sample_rate=sample_rate,
                    num_channels=num_channels,
                    api_key=api_key,
                    config=config,
                    function_id=func_id,
                    diag=diag,
                )
                
                frames = resample_frames_to_fps(frames, float(args.fps))
                diag.frame_count = len(frames)
                diag.blendshape_stats = compute_stats(frames)
                
                top_val = max((mx for _, (_, mx, _) in diag.blendshape_stats.items()), default=0)
                comparison_results.append({
                    "name": name,
                    "success": True,
                    "frames": len(frames),
                    "has_tongue": diag.has_tongue,
                    "max_value": top_val,
                })
                
                print(f"  ✓ {len(frames)} frames, has_tongue={diag.has_tongue}, max_value={top_val:.3f}")
                
            except Exception as e:
                comparison_results.append({
                    "name": name,
                    "success": False,
                    "error": str(e),
                })
                print(f"  ✗ Error: {e}")
        
        print("\n" + "="*70)
        print("COMPARISON SUMMARY")
        print("="*70)
        for result in comparison_results:
            status = "✓ OK" if result["success"] else "✗ FAIL"
            if result["success"]:
                print(f"{status}  {result['name']:35s}  frames={result['frames']:5d}  tongue={result['has_tongue']}  max={result['max_value']:.3f}")
            else:
                print(f"{status}  {result['name']:35s}  {result['error']}")
        
        print("="*70 + "\n")
        return 0
    
    # Standard single-extraction path
    print(f"\nProcessing audio: {args.wav}")
    print(f"Duration: {audio_duration:.2f}s, Sample Rate: {sample_rate} Hz")
    
    diag = DiagnosticStats()
    
    frames = call_a2f_grpc(
        pcm_bytes=pcm_bytes,
        sample_rate=sample_rate,
        num_channels=num_channels,
        api_key=api_key,
        config=config,
        function_id=args.function_id,
        diag=diag,
    )
    
    # Apply smoothing if requested
    if args.smooth > 1:
        print(f"Applying smoothing (window={args.smooth})...")
        frames = smooth_frames(frames, args.smooth)
    
    # Resample to target FPS
    fps = int(args.fps)
    frames_resampled = resample_frames_to_fps(frames, float(fps))
    
    # Compute stats before gains
    stats_before = compute_stats(frames_resampled)
    
    # Apply gains
    if any(g != 1.0 for g in [args.global_gain, args.jaw_gain, args.lip_gain, args.tongue_gain]) or args.silence_gate > 0:
        print(f"Applying gains: global={args.global_gain:.2f} jaw={args.jaw_gain:.2f} lip={args.lip_gain:.2f} tongue={args.tongue_gain:.2f} gate={args.silence_gate:.3f}")
        frames_resampled = [
            A2FFrame(
                time_seconds=f.time_seconds,
                weights=_apply_gains(
                    f.weights,
                    global_gain=args.global_gain,
                    jaw_gain=args.jaw_gain,
                    lip_gain=args.lip_gain,
                    tongue_gain=args.tongue_gain,
                    silence_gate=args.silence_gate,
                )
            )
            for f in frames_resampled
        ]
    
    # Compute final stats
    stats_after = compute_stats(frames_resampled)
    
    # Write JSON
    write_timeseries_json(args.out, fps, frames_resampled)
    print(f"Wrote {len(frames_resampled)} frames to {args.out}\n")
    
    # Update diagnostics
    diag.frame_count = len(frames_resampled)
    diag.raw_frame_count = len(frames)
    diag.blendshape_stats = stats_after
    
    # Print diagnostics
    print_diagnostics(diag, frames_resampled)
    
    # Warnings
    print("WARNINGS & RECOMMENDATIONS:")
    near_zero = sum(1 for _, (_, _, mean) in stats_after.items() if mean < 0.01)
    if near_zero > len(stats_after) * 0.5:
        print(f"  ⚠ {near_zero}/{len(stats_after)} blendshapes have mean < 0.01 (very small movements)")
        print(f"    Consider increasing --global-gain (currently {args.global_gain})")
    
    fully_zero = sum(1 for _, (mn, mx, _) in stats_after.items() if mx == 0)
    if fully_zero > 0:
        print(f"  ⚠ {fully_zero} blendshapes are completely zero (no activation)")
    
    saturated = sum(1 for _, (_, mx, _) in stats_after.items() if mx > 0.95)
    if saturated > 0:
        print(f"  ⚠ {saturated} blendshapes are saturated (max > 0.95)")
    
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
