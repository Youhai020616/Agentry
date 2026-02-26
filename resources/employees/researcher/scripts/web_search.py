#!/usr/bin/env python3
"""
Web Search Tool using Tavily API
Provides web search capabilities for the Research Analyst employee.
"""

import os
import sys
import json
import argparse
import requests

TAVILY_API_URL = "https://api.tavily.com/search"


def get_api_key():
    """Get Tavily API key from environment variable."""
    api_key = os.environ.get("TAVILY_API_KEY")
    if api_key:
        return api_key

    # Try reading from .env file in skill directory
    from pathlib import Path

    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TAVILY_API_KEY="):
                    return line.split("=", 1)[1].strip()

    return None


def web_search(query, max_results=5):
    """
    Search the web using Tavily API.

    Args:
        query: Search query string
        max_results: Maximum number of results to return

    Returns:
        dict with success status and search results or error
    """
    api_key = get_api_key()
    if not api_key:
        return {
            "success": False,
            "error": "Tavily API key not found. Please set TAVILY_API_KEY environment variable or configure it in Settings > Employee Secrets.",
        }

    try:
        response = requests.post(
            TAVILY_API_URL,
            json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "include_answer": True,
                "include_raw_content": False,
            },
            timeout=30,
        )

        if response.status_code != 200:
            error_msg = f"Tavily API returned status {response.status_code}"
            try:
                error_detail = response.json()
                error_msg += f": {json.dumps(error_detail, ensure_ascii=False)}"
            except Exception:
                error_msg += f": {response.text}"
            return {"success": False, "error": error_msg}

        data = response.json()

        results = []
        for item in data.get("results", []):
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("content", "")[:500],
                }
            )

        return {
            "success": True,
            "query": query,
            "answer": data.get("answer", ""),
            "results": results,
        }

    except requests.exceptions.Timeout:
        return {"success": False, "error": "Search request timed out"}
    except requests.exceptions.ConnectionError:
        return {"success": False, "error": "Network connection error"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="Search the web using Tavily API")
    parser.add_argument("query", help="Search query")
    parser.add_argument(
        "--max-results",
        type=int,
        default=5,
        help="Maximum number of results (default: 5)",
    )

    args = parser.parse_args()

    result = web_search(query=args.query, max_results=args.max_results)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
