#!/usr/bin/env python3
"""
Image Generator Script
使用 DeerAPI 的 Gemini 3 Pro 模型生成图片
"""

import os
import sys
import json
import base64
import argparse
import requests
from datetime import datetime
from pathlib import Path

# 配置
DEERAPI_BASE_URL = "https://api.deerapi.com/v1"
MODEL_NAME = "gemini-3-pro-image"
DEFAULT_OUTPUT_DIR = "."


def get_api_key():
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


def generate_image(prompt: str, output_dir: str = DEFAULT_OUTPUT_DIR, filename: str = None) -> dict:
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
            "error": "API key not found. Please set DEERAPI_KEY environment variable or configure ~/.claude/skills/image-generator/.env"
        }

    # 构建请求
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Gemini 图片生成 API 请求格式
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    }

    try:
        print(f"正在生成图片，提示词: {prompt[:50]}{'...' if len(prompt) > 50 else ''}")

        response = requests.post(
            f"{DEERAPI_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=120  # 图片生成可能需要较长时间
        )

        if response.status_code != 200:
            error_msg = f"API request failed with status {response.status_code}"
            try:
                error_detail = response.json()
                error_msg += f": {json.dumps(error_detail, ensure_ascii=False)}"
            except:
                error_msg += f": {response.text}"
            return {"success": False, "error": error_msg}

        result = response.json()

        # 解析响应，提取图片数据
        # Gemini 图片生成通常返回 base64 编码的图片
        choices = result.get("choices", [])
        if not choices:
            return {"success": False, "error": "No image generated in response"}

        message = choices[0].get("message", {})
        content = message.get("content", "")

        # 检查是否有图片数据
        # 可能在 content 中直接包含 base64，或在特定字段中
        image_data = None
        image_format = "png"  # 默认格式

        # 尝试从 content 中提取 base64 图片
        if isinstance(content, str):
            # 1. 检查 Markdown 格式: ![image](data:image/jpeg;base64,xxxxx)
            import re
            md_match = re.search(r'!\[.*?\]\(data:image/(\w+);base64,([A-Za-z0-9+/=]+)\)', content)
            if md_match:
                image_format = md_match.group(1)  # jpeg, png, etc.
                image_data = md_match.group(2)
            # 2. 检查纯 data URL 格式: data:image/png;base64,xxxxx
            elif content.startswith("data:image"):
                format_match = re.search(r'data:image/(\w+);base64,', content)
                if format_match:
                    image_format = format_match.group(1)
                image_data = content.split(",", 1)[1] if "," in content else None
            # 3. 检查内嵌的 data URL (在文本中间)
            elif "data:image" in content:
                data_match = re.search(r'data:image/(\w+);base64,([A-Za-z0-9+/=]+)', content)
                if data_match:
                    image_format = data_match.group(1)
                    image_data = data_match.group(2)
            # 4. 可能是纯 base64 数据
            elif len(content) > 1000 and not content.startswith("http"):
                try:
                    base64.b64decode(content)
                    image_data = content
                except:
                    pass

        # 检查 content 是否为列表格式（多模态响应）
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "image" or "image" in item:
                        img = item.get("image", item)
                        if isinstance(img, dict):
                            image_data = img.get("data") or img.get("base64")
                        elif isinstance(img, str):
                            image_data = img
                        break

        # 检查是否有 image 字段
        if not image_data and "image" in message:
            img = message["image"]
            if isinstance(img, dict):
                image_data = img.get("data") or img.get("base64") or img.get("url")
            else:
                image_data = img

        # 如果还是没有图片，检查其他可能的位置
        if not image_data:
            # 有些 API 会在顶层返回
            if "image" in result:
                img = result["image"]
                if isinstance(img, dict):
                    image_data = img.get("data") or img.get("base64")
                else:
                    image_data = img
            elif "data" in result:
                data = result["data"]
                if isinstance(data, list) and len(data) > 0:
                    item = data[0]
                    if isinstance(item, dict):
                        image_data = item.get("b64_json") or item.get("url")

        if not image_data:
            # 如果仍然没有找到图片，返回原始响应供调试
            return {
                "success": False,
                "error": "Could not extract image from response",
                "raw_response": result
            }

        # 处理 URL 类型的图片
        if isinstance(image_data, str) and image_data.startswith("http"):
            print(f"图片已生成，URL: {image_data}")
            return {
                "success": True,
                "message": "Image generated successfully",
                "image_url": image_data
            }

        # 保存 base64 图片到文件
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

        # 解码并保存图片
        try:
            image_bytes = base64.b64decode(image_data)
            with open(file_path, "wb") as f:
                f.write(image_bytes)

            abs_path = str(file_path.absolute())
            print(f"图片已保存到: {abs_path}")

            return {
                "success": True,
                "message": "Image generated and saved successfully",
                "file_path": abs_path
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to save image: {str(e)}"
            }

    except requests.exceptions.Timeout:
        return {"success": False, "error": "Request timeout. Please try again."}
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": f"Request failed: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Generate images using DeerAPI Gemini 3 Pro")
    parser.add_argument("prompt", help="Image description prompt")
    parser.add_argument("--output", "-o", default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument("--filename", "-f", help="Output filename")

    args = parser.parse_args()

    result = generate_image(
        prompt=args.prompt,
        output_dir=args.output,
        filename=args.filename
    )

    # 输出 JSON 结果
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 根据结果设置退出码
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
