#!/usr/bin/env python3
"""
Xiaohongshu (小红书) Note Publisher
Thin wrapper around xiaohongshu-mcp REST API (https://github.com/xpzouying/xiaohongshu-mcp).

xiaohongshu-mcp runs as a local service on port 18060, providing Go + go-rod browser
automation with stealth anti-detection. This script calls its HTTP API to publish notes.

Prerequisites:
  - xiaohongshu-mcp service running: ./xiaohongshu-mcp -port :18060
  - Logged in via: ./login (scans QR code, saves cookies)
"""

import os
import sys
import json
import argparse
import requests

DEFAULT_XHS_MCP_URL = "http://127.0.0.1:18060"


def get_base_url():
    """Get xiaohongshu-mcp service base URL from env or default."""
    return os.environ.get("XHS_MCP_URL", DEFAULT_XHS_MCP_URL)


def check_service(base_url):
    """Check if xiaohongshu-mcp service is running."""
    try:
        resp = requests.get(f"{base_url}/api/v1/login/status", timeout=5)
        return resp.status_code == 200
    except requests.exceptions.ConnectionError:
        return False


def check_login(base_url):
    """Check if the user is logged in to Xiaohongshu."""
    try:
        resp = requests.get(f"{base_url}/api/v1/login/status", timeout=10)
        data = resp.json()
        return data.get("logged_in", False) or data.get("success", False)
    except Exception:
        return False


def get_login_qrcode(base_url):
    """Get QR code for login."""
    try:
        resp = requests.get(f"{base_url}/api/v1/login/qrcode", timeout=10)
        return resp.json()
    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_note(title, content, images, tags, schedule_at=None):
    """
    Publish a note to Xiaohongshu via xiaohongshu-mcp REST API.

    Uses POST /api/v1/publish which internally:
    1. Navigates to creator.xiaohongshu.com/publish/publish
    2. Uploads images via input[type="file"] (go-rod MustSetFiles)
    3. Fills title (div.d-input input, max 20 chars)
    4. Fills content (div.ql-editor, max 1000 chars)
    5. Adds tags with # prefix, selects from autocomplete dropdown
    6. Clicks publish button (.publish-page-publish-btn button.bg-red)

    Args:
        title: Note title (max 20 characters)
        content: Note body text (max 1000 characters)
        images: List of local image paths or HTTP URLs
        tags: List of topic tags (without # prefix)
        schedule_at: Optional ISO 8601 datetime for scheduled publish

    Returns:
        dict with success status and details or error
    """
    base_url = get_base_url()

    # Pre-flight: check service
    if not check_service(base_url):
        return {
            "success": False,
            "error": (
                "xiaohongshu-mcp service is not running. "
                "Start it with: ./xiaohongshu-mcp -port :18060"
            ),
        }

    # Pre-flight: check login
    if not check_login(base_url):
        return {
            "success": False,
            "error": (
                "Not logged in to Xiaohongshu. "
                "Run the login tool first: ./login (scan QR code with XHS app)"
            ),
        }

    # Validate local image files exist
    for img in images:
        if not img.startswith("http://") and not img.startswith("https://"):
            if not os.path.exists(img):
                return {"success": False, "error": f"Image file not found: {img}"}

    # Build request payload (matches xiaohongshu-mcp API schema)
    payload = {
        "title": title[:20],
        "content": content[:1000],
        "images": images,
        "tags": tags,
    }
    if schedule_at:
        payload["schedule_at"] = schedule_at

    try:
        resp = requests.post(
            f"{base_url}/api/v1/publish",
            json=payload,
            timeout=120,
        )

        if resp.status_code != 200:
            error_msg = f"API returned status {resp.status_code}"
            try:
                error_detail = resp.json()
                error_msg += f": {json.dumps(error_detail, ensure_ascii=False)}"
            except Exception:
                error_msg += f": {resp.text}"
            return {"success": False, "error": error_msg}

        result = resp.json()

        return {
            "success": True,
            "title": payload["title"],
            "images_count": len(images),
            "tags": tags,
            "scheduled": schedule_at,
            "detail": result,
        }

    except requests.exceptions.Timeout:
        return {"success": False, "error": "Publish request timed out (120s)"}
    except requests.exceptions.ConnectionError:
        return {"success": False, "error": "Lost connection to xiaohongshu-mcp service"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def publish_video(title, content, video_path, tags, schedule_at=None):
    """
    Publish a video note to Xiaohongshu via xiaohongshu-mcp REST API.

    Uses POST /api/v1/publish_video.

    Args:
        title: Video title (max 20 characters)
        content: Video description (max 1000 characters)
        video_path: Local path to video file
        tags: List of topic tags
        schedule_at: Optional ISO 8601 datetime for scheduled publish

    Returns:
        dict with success status and details or error
    """
    base_url = get_base_url()

    if not check_service(base_url):
        return {
            "success": False,
            "error": "xiaohongshu-mcp service is not running.",
        }

    if not check_login(base_url):
        return {
            "success": False,
            "error": "Not logged in to Xiaohongshu.",
        }

    if not os.path.exists(video_path):
        return {"success": False, "error": f"Video file not found: {video_path}"}

    payload = {
        "title": title[:20],
        "content": content[:1000],
        "video_path": video_path,
        "tags": tags,
    }
    if schedule_at:
        payload["schedule_at"] = schedule_at

    try:
        resp = requests.post(
            f"{base_url}/api/v1/publish_video",
            json=payload,
            timeout=300,
        )

        if resp.status_code != 200:
            return {"success": False, "error": f"API returned status {resp.status_code}: {resp.text}"}

        return {
            "success": True,
            "title": payload["title"],
            "tags": tags,
            "detail": resp.json(),
        }

    except requests.exceptions.Timeout:
        return {"success": False, "error": "Video publish timed out (300s)"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(
        description="Publish to Xiaohongshu (小红书) via xiaohongshu-mcp service"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Subcommand: status
    subparsers.add_parser("status", help="Check service and login status")

    # Subcommand: publish (image note)
    pub = subparsers.add_parser("publish", help="Publish an image note")
    pub.add_argument("--title", required=True, help="Note title (max 20 characters)")
    pub.add_argument("--content", required=True, help="Note body text (max 1000 characters)")
    pub.add_argument("--images", required=True, help="Comma-separated image paths or URLs")
    pub.add_argument("--tags", default="", help="Comma-separated topic tags")
    pub.add_argument("--schedule", default=None, help="Schedule time (ISO 8601, e.g. 2025-01-15T10:00:00+08:00)")

    # Subcommand: publish-video
    vid = subparsers.add_parser("publish-video", help="Publish a video note")
    vid.add_argument("--title", required=True, help="Video title (max 20 characters)")
    vid.add_argument("--content", required=True, help="Video description (max 1000 characters)")
    vid.add_argument("--video", required=True, help="Path to video file")
    vid.add_argument("--tags", default="", help="Comma-separated topic tags")
    vid.add_argument("--schedule", default=None, help="Schedule time (ISO 8601)")

    args = parser.parse_args()

    if args.command == "status":
        base_url = get_base_url()
        service_ok = check_service(base_url)
        login_ok = check_login(base_url) if service_ok else False
        result = {
            "success": True,
            "service_running": service_ok,
            "logged_in": login_ok,
            "service_url": base_url,
        }
    elif args.command == "publish":
        images = [p.strip() for p in args.images.split(",") if p.strip()]
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        result = publish_note(args.title, args.content, images, tags, args.schedule)
    elif args.command == "publish-video":
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        result = publish_video(args.title, args.content, args.video, tags, args.schedule)
    else:
        parser.print_help()
        sys.exit(0)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
