#!/usr/bin/env python3
"""
Gemini Image Generate — DeerAPI (Gemini native format) compatible script.

Calls DeerAPI using Google's Gemini native API format
(generativelanguage endpoint, NOT OpenAI format).

Usage:
    python gemini_image_generate.py \
        --prompt "..." \
        --model gemini-2.5-flash-image \
        --out-dir /tmp/rpg-bg-xxx \
        [--reference-image /path/to/ref.webp] \
        [--aspect-ratio 16:9] \
        [--cleanup]

Environment:
    GEMINI_API_KEY   — DeerAPI API key (required)
    GEMINI_MODEL     — override model name (optional)
    GEMINI_BASE_URL  — override base URL (optional, default: https://api.deerapi.com)

Output:
    Prints JSON to stdout on the last line:
    {"files": ["/tmp/rpg-bg-xxx/generated_0.png"]}
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_BASE_URL = "https://api.deerapi.com"

# Map Star Office model names to actual Gemini model IDs
MODEL_MAP = {
    "nano-banana-pro-preview": "gemini-2.5-flash-image",
    "nanobanana-pro": "gemini-2.5-flash-image",
    "nanobanana-2": "gemini-2.5-flash-image",
    "gemini-2.0-flash-exp-image-generation": "gemini-2.0-flash-exp-image-generation",
    "gemini-2.5-flash-image": "gemini-2.5-flash-image",
    "gemini-2.5-flash-image-preview": "gemini-2.5-flash-image",
    "gemini-3.0-pro-image-preview": "gemini-3.0-pro-image-preview",
}


def resolve_model(model_name: str) -> str:
    """Resolve model alias to actual Gemini model ID."""
    return MODEL_MAP.get(model_name, model_name)


def read_image_base64(path: str) -> tuple[str, str]:
    """Read image file, return (base64_data, mime_type)."""
    ext = os.path.splitext(path)[1].lower()
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    mime = mime_map.get(ext, "image/png")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return b64, mime


def generate_image(
    prompt: str,
    model: str,
    out_dir: str,
    api_key: str,
    reference_image: str | None = None,
    aspect_ratio: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
) -> list[str]:
    """Call DeerAPI (Gemini native format) to generate an image."""

    os.makedirs(out_dir, exist_ok=True)

    actual_model = resolve_model(model)

    # Build request parts
    parts = []

    # Add reference image first if provided
    if reference_image and os.path.exists(reference_image):
        b64_data, mime_type = read_image_base64(reference_image)
        parts.append({
            "inlineData": {
                "mimeType": mime_type,
                "data": b64_data,
            }
        })

    # Add text prompt
    parts.append({"text": prompt})

    # Build payload (Gemini native format)
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
        },
    }

    # Add aspect ratio if specified (supported by some models)
    if aspect_ratio:
        payload["generationConfig"]["aspectRatio"] = aspect_ratio

    # Use Gemini native endpoint
    url = f"{base_url}/v1beta/models/{actual_model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        # Check for model not found
        if e.code == 404 or "not found" in body.lower():
            print(f"Model not available: {actual_model}. Error: {body}", file=sys.stderr)
        else:
            print(f"API error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract images from Gemini response
    output_files = []
    candidates = result.get("candidates", [])

    for i, candidate in enumerate(candidates):
        content = candidate.get("content", {})
        parts = content.get("parts", [])

        for j, part in enumerate(parts):
            inline_data = part.get("inlineData")
            if inline_data:
                mime_type = inline_data.get("mimeType", "image/png")
                b64_data = inline_data.get("data", "")

                if not b64_data:
                    continue

                # Determine extension from mime type
                ext_map = {
                    "image/png": ".png",
                    "image/jpeg": ".jpg",
                    "image/webp": ".webp",
                    "image/gif": ".gif",
                }
                ext = ext_map.get(mime_type, ".png")
                out_path = os.path.join(out_dir, f"generated_{i}_{j}{ext}")

                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(b64_data))
                output_files.append(out_path)

    if not output_files:
        # Check for safety blocks or other issues
        block_reason = ""
        for candidate in candidates:
            fr = candidate.get("finishReason", "")
            if fr and fr != "STOP":
                block_reason = fr
        if not candidates:
            block_reason = result.get("promptFeedback", {}).get("blockReason", "UNKNOWN")

        print(f"No images generated. Reason: {block_reason or 'unknown'}. "
              f"Response: {json.dumps(result, ensure_ascii=False)[:500]}", file=sys.stderr)
        sys.exit(1)

    return output_files


def main():
    parser = argparse.ArgumentParser(description="Generate images via DeerAPI (Gemini native format)")
    parser.add_argument("--prompt", required=True, help="Image generation prompt")
    parser.add_argument("--model", default="gemini-2.5-flash-image", help="Model name")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--reference-image", default=None, help="Reference image path")
    parser.add_argument("--aspect-ratio", default=None, help="Aspect ratio (e.g. 16:9)")
    parser.add_argument("--cleanup", action="store_true", help="(ignored, for compat)")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    # Allow override via env
    model = os.environ.get("GEMINI_MODEL", "").strip() or args.model
    base_url = os.environ.get("GEMINI_BASE_URL", "").strip() or DEFAULT_BASE_URL

    files = generate_image(
        prompt=args.prompt,
        model=model,
        out_dir=args.out_dir,
        api_key=api_key,
        reference_image=args.reference_image,
        aspect_ratio=args.aspect_ratio,
        base_url=base_url,
    )

    # Output JSON on last line (expected by Star Office backend)
    print(json.dumps({"files": files}))


if __name__ == "__main__":
    main()
