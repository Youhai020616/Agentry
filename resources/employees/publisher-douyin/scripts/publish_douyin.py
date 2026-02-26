#!/usr/bin/env python3
"""
Douyin (抖音) Video Publisher
Wrapper around social-auto-upload (https://github.com/dreammis/social-auto-upload).

social-auto-upload provides Playwright-based browser automation with stealth.min.js
anti-detection for publishing to Douyin, Xiaohongshu, Bilibili, and other platforms.

Prerequisites:
  - social-auto-upload installed: pip install -e /path/to/social-auto-upload
    OR cloned to: ~/.openclaw/extensions/social-auto-upload
  - Playwright + Chromium: playwright install chromium
  - Cookie file generated via: python examples/get_douyin_cookie.py
"""

import os
import sys
import json
import argparse
import asyncio
from pathlib import Path
from datetime import datetime

# Try to import social-auto-upload from multiple locations
SAU_PATHS = [
    os.path.expanduser("~/.openclaw/extensions/social-auto-upload"),
    os.path.expanduser("~/social-auto-upload"),
    os.environ.get("SAU_PATH", ""),
]

for sau_path in SAU_PATHS:
    if sau_path and os.path.isdir(sau_path):
        if sau_path not in sys.path:
            sys.path.insert(0, sau_path)
        break


def check_sau_available():
    """Check if social-auto-upload is importable."""
    try:
        from uploader.douyin_uploader.main import DouYinVideo, douyin_setup  # noqa: F401

        return True
    except ImportError:
        return False


def get_cookie_path(account_name="default"):
    """Get the cookie file path for a Douyin account."""
    cookie_dir = Path(__file__).parent.parent / "data" / "cookies"
    cookie_dir.mkdir(parents=True, exist_ok=True)
    return str(cookie_dir / f"douyin_{account_name}.json")


async def setup_account(account_file, handle=False):
    """Validate cookies or trigger login flow."""
    from uploader.douyin_uploader.main import douyin_setup

    return await douyin_setup(account_file, handle=handle)


async def upload_video(video_path, title, tags, account_file, cover=None, schedule=None):
    """
    Upload a video to Douyin via social-auto-upload.

    Internally uses Playwright to:
    1. Launch Chromium with saved cookies + stealth.min.js
    2. Navigate to creator.douyin.com/creator-micro/content/upload
    3. Upload video via input[type="file"] (set_input_files)
    4. Wait for upload + processing (checks for "重新上传" text)
    5. Fill title (作品标题 input, max 30 chars)
    6. Add tags with # prefix in .zone-container
    7. Optionally set cover image and schedule time
    8. Click 发布 button, wait for redirect to /content/manage

    Args:
        video_path: Path to the video file (.mp4)
        title: Video title/description (max 30 chars for Douyin)
        tags: List of topic tags
        account_file: Path to Playwright storage_state cookie JSON
        cover: Optional path to cover image
        schedule: Optional datetime for scheduled publish (None = immediate)

    Returns:
        dict with success status
    """
    from uploader.douyin_uploader.main import DouYinVideo

    publish_date = 0  # 0 = immediate publish
    if schedule:
        if isinstance(schedule, str):
            publish_date = datetime.fromisoformat(schedule)
        else:
            publish_date = schedule

    app = DouYinVideo(
        title=title,
        file_path=video_path,
        tags=tags,
        publish_date=publish_date,
        account_file=account_file,
        thumbnail_path=cover,
    )

    await app.main()
    return True


def publish(video_path, title, tags, account_name="default", cover=None, schedule=None):
    """
    Synchronous entry point for Douyin video publishing.

    Returns:
        dict with success status and details or error
    """
    # Check social-auto-upload is available
    if not check_sau_available():
        return {
            "success": False,
            "error": (
                "social-auto-upload not found. Install it:\n"
                "  git clone https://github.com/dreammis/social-auto-upload ~/.openclaw/extensions/social-auto-upload\n"
                "  cd ~/.openclaw/extensions/social-auto-upload && pip install -r requirements.txt\n"
                "  playwright install chromium"
            ),
        }

    # Validate video file
    if not os.path.exists(video_path):
        return {"success": False, "error": f"Video file not found: {video_path}"}

    # Validate cover image if provided
    if cover and not os.path.exists(cover):
        return {"success": False, "error": f"Cover image not found: {cover}"}

    account_file = get_cookie_path(account_name)

    # Check/validate cookies
    try:
        cookie_ok = asyncio.run(setup_account(account_file, handle=False))
        if not cookie_ok:
            return {
                "success": False,
                "error": (
                    "Douyin cookies expired or not found. "
                    "Run login first: python scripts/publish_douyin.py login"
                ),
            }
    except Exception as e:
        return {"success": False, "error": f"Cookie validation failed: {str(e)}"}

    # Execute upload
    try:
        asyncio.run(upload_video(video_path, title, tags, account_file, cover, schedule))
        return {
            "success": True,
            "title": title[:30],
            "tags": tags,
            "video": os.path.basename(video_path),
            "scheduled": schedule,
        }
    except Exception as e:
        return {"success": False, "error": f"Upload failed: {str(e)}"}


def login(account_name="default"):
    """Open browser for QR code login to Douyin."""
    if not check_sau_available():
        return {
            "success": False,
            "error": "social-auto-upload not found.",
        }

    account_file = get_cookie_path(account_name)

    try:
        # handle=True opens visible browser for QR scan + Playwright Inspector
        result = asyncio.run(setup_account(account_file, handle=True))
        return {
            "success": result,
            "cookie_file": account_file,
            "message": "Login successful, cookies saved." if result else "Login failed or cancelled.",
        }
    except Exception as e:
        return {"success": False, "error": f"Login failed: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(
        description="Publish videos to Douyin (抖音) via social-auto-upload"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Subcommand: status
    subparsers.add_parser("status", help="Check if social-auto-upload is available")

    # Subcommand: login
    log = subparsers.add_parser("login", help="Open browser for QR code login")
    log.add_argument("--account", default="default", help="Account name for cookie isolation")

    # Subcommand: upload
    up = subparsers.add_parser("upload", help="Upload a video to Douyin")
    up.add_argument("--video", required=True, help="Path to video file (.mp4)")
    up.add_argument("--title", required=True, help="Video title (max 30 characters)")
    up.add_argument("--tags", default="", help="Comma-separated topic tags")
    up.add_argument("--cover", default=None, help="Path to cover image (optional)")
    up.add_argument(
        "--schedule",
        default=None,
        help="Schedule time ISO 8601 (optional, e.g. 2025-01-15T10:00:00)",
    )
    up.add_argument("--account", default="default", help="Account name for cookie isolation")

    args = parser.parse_args()

    if args.command == "status":
        available = check_sau_available()
        result = {
            "success": True,
            "sau_available": available,
            "sau_search_paths": [p for p in SAU_PATHS if p],
        }
    elif args.command == "login":
        result = login(account_name=args.account)
    elif args.command == "upload":
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        result = publish(
            video_path=args.video,
            title=args.title,
            tags=tags,
            account_name=args.account,
            cover=args.cover,
            schedule=args.schedule,
        )
    else:
        parser.print_help()
        sys.exit(0)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
