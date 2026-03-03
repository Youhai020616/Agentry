#!/usr/bin/env python3
# pyright: basic
"""
Image Generator Script
使用 DeerAPI 的 Gemini 3 Pro 模型生成图片
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

# 配置
DEERAPI_BASE_URL = "https://api.deerapi.com/v1"
MODEL_NAME = "gemini-3-pro-image"
DEFAULT_OUTPUT_DIR = "."


def get_api_key() -> str | None:
    """获取 API Key，优先从环境变量获取，其次从 .env 文件"""
    api_key = os.environ.get("DEERAPI_KEY")
    if api_key:
        return api_key

    # 尝试从 skill 目录的 .env 文件读取
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DEERAPI_KEY="):
                    return line.split("=", 1)[1].strip()

    return None


def _extract_image_from_content(content: str) -> tuple[str | None, str]:
    """
    从字符串 content 中提取图片数据。

    Returns:
        (image_data, image_format) — image_data 为 base64 字符串或 URL，
        image_format 为文件扩展名（png/jpeg/webp 等）。
    """
    image_format = "png"

    # 1. Markdown 格式: ![image](data:image/jpeg;base64,xxxxx)
    md_match = re.search(
        r"!\[.*?\]\(data:image/(\w+);base64,([A-Za-z0-9+/=]+)\)", content
    )
    if md_match:
        return md_match.group(2), md_match.group(1)

    # 2. 纯 data URL 格式: data:image/png;base64,xxxxx
    if content.startswith("data:image"):
        format_match = re.search(r"data:image/(\w+);base64,", content)
        if format_match:
            image_format = format_match.group(1)
        if "," in content:
            return content.split(",", 1)[1], image_format
        return None, image_format

    # 3. 内嵌的 data URL（在文本中间）
    if "data:image" in content:
        data_match = re.search(r"data:image/(\w+);base64,([A-Za-z0-9+/=]+)", content)
        if data_match:
            return data_match.group(2), data_match.group(1)

    # 4. 可能是纯 base64 数据（长字符串且不是 URL）
    if len(content) > 1000 and not content.startswith("http"):
        cleaned = content.strip()
        if re.fullmatch(r"[A-Za-z0-9+/=]+", cleaned):
            return cleaned, image_format

    # 5. 纯 URL
    if content.startswith("http"):
        return content.strip(), image_format

    return None, image_format


def _extract_image_from_multimodal(content: list[Any]) -> str | None:
    """从多模态列表格式的 content 中提取图片 base64 数据。"""
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "image" or "image" in item:
            img: Any = item.get("image", item)
            if isinstance(img, dict):
                data: str | None = img.get("data") or img.get("base64")
                return data
            if isinstance(img, str):
                return img
    return None


def _extract_image_from_field(
    obj: dict[str, Any], key: str
) -> tuple[str | None, str | None]:
    """
    从 dict 的指定 key 中提取图片。

    Returns:
        (image_data, image_url) — 至多一个非 None。
    """
    if key not in obj:
        return None, None

    img: Any = obj[key]
    if isinstance(img, dict):
        data: str | None = img.get("data") or img.get("base64")
        if data:
            return data, None
        url: str | None = img.get("url")
        if isinstance(url, str):
            return None, url
    elif isinstance(img, str):
        if img.startswith("http"):
            return None, img
        return img, None

    return None, None


def generate_image(
    prompt: str,
    output_dir: str = DEFAULT_OUTPUT_DIR,
    filename: str | None = None,
) -> dict[str, Any]:
    """
    调用 DeerAPI 生成图片

    Args:
        prompt: 图片描述提示词
        output_dir: 输出目录
        filename: 文件名（可选）

    Returns:
        dict: 包含 success, message, file_path 等信息
    """
    api_key = get_api_key()
    if not api_key:
        return {
            "success": False,
            "error": (
                "API key not found. Please set DEERAPI_KEY environment variable "
                "or configure it in Settings > Employee Secrets."
            ),
        }

    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload: dict[str, Any] = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        print(f"正在生成图片，提示词: {prompt[:50]}{'...' if len(prompt) > 50 else ''}")

        response = requests.post(
            f"{DEERAPI_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=120,
        )

        if response.status_code != 200:
            error_msg = f"API request failed with status {response.status_code}"
            try:
                error_detail: dict[str, Any] = response.json()
                error_msg += f": {json.dumps(error_detail, ensure_ascii=False)}"
            except (ValueError, json.JSONDecodeError):
                error_msg += f": {response.text}"
            return {"success": False, "error": error_msg}

        result: dict[str, Any] = response.json()

        # ── 解析响应，提取图片数据 ──────────────────────────────
        choices: list[dict[str, Any]] = result.get("choices", [])
        if not choices:
            return {"success": False, "error": "No image generated in response"}

        message: dict[str, Any] = choices[0].get("message", {})
        content: Any = message.get("content", "")

        image_data: str | None = None
        image_format: str = "png"

        # ── 字符串 content ──────────────────────────────────────
        if isinstance(content, str):
            image_data, image_format = _extract_image_from_content(content)
            # 如果提取到的是 URL，直接返回
            if image_data and image_data.startswith("http"):
                print(f"图片已生成，URL: {image_data}")
                return {
                    "success": True,
                    "message": "Image generated successfully",
                    "image_url": image_data,
                }

        # ── 列表 content（多模态响应）──────────────────────────
        if not image_data and isinstance(content, list):
            image_data = _extract_image_from_multimodal(content)

        # ── message.image 字段 ─────────────────────────────────
        if not image_data:
            data, url = _extract_image_from_field(message, "image")
            if url:
                print(f"图片已生成，URL: {url}")
                return {
                    "success": True,
                    "message": "Image generated successfully",
                    "image_url": url,
                }
            image_data = data

        # ── 顶层 result.image / result.data ────────────────────
        if not image_data:
            data, url = _extract_image_from_field(result, "image")
            if url:
                print(f"图片已生成，URL: {url}")
                return {
                    "success": True,
                    "message": "Image generated successfully",
                    "image_url": url,
                }
            image_data = data

        if not image_data and "data" in result:
            data_list: Any = result["data"]
            if isinstance(data_list, list) and len(data_list) > 0:
                item: Any = data_list[0]
                if isinstance(item, dict):
                    image_data = item.get("b64_json") or item.get("url")

        # ── 无法提取 ──────────────────────────────────────────
        if not image_data:
            return {
                "success": False,
                "error": "Could not extract image from response",
                "raw_response": result,
            }

        # ── URL 类型的图片 ─────────────────────────────────────
        if isinstance(image_data, str) and image_data.startswith("http"):
            print(f"图片已生成，URL: {image_data}")
            return {
                "success": True,
                "message": "Image generated successfully",
                "image_url": image_data,
            }

        # ── 保存 base64 图片到文件 ─────────────────────────────
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            ext = "jpg" if image_format == "jpeg" else image_format
            filename = f"generated_{timestamp}.{ext}"

        if not filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            ext = "jpg" if image_format == "jpeg" else image_format
            filename += f".{ext}"

        file_path = output_path / filename

        try:
            image_bytes = base64.b64decode(image_data)
            with open(file_path, "wb") as f:
                f.write(image_bytes)

            abs_path = str(file_path.absolute())
            print(f"图片已保存到: {abs_path}")

            return {
                "success": True,
                "message": "Image generated and saved successfully",
                "file_path": abs_path,
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to save image: {str(e)}"}

    except requests.exceptions.Timeout:
        return {"success": False, "error": "Request timeout. Please try again."}
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": f"Request failed: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate images using DeerAPI Gemini 3 Pro"
    )
    parser.add_argument("prompt", help="Image description prompt")
    parser.add_argument(
        "--output", "-o", default=DEFAULT_OUTPUT_DIR, help="Output directory"
    )
    parser.add_argument("--filename", "-f", help="Output filename")

    args = parser.parse_args()

    result = generate_image(
        prompt=args.prompt,
        output_dir=args.output,
        filename=args.filename,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
