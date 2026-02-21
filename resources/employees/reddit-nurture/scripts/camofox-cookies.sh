#!/bin/bash
# Camofox cookie backup/restore for Reddit nurture
# Usage:
#   ./camofox-cookies.sh export <userId> [file]
#   ./camofox-cookies.sh import <userId> [file]

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-export}"
USER_ID="${2:-test1}"
COOKIE_DIR="$SKILL_DIR/data/cookies"
FILE="${3:-$COOKIE_DIR/${USER_ID}.json}"

# Read port from config if available
CONFIG="$SKILL_DIR/config.json"
if [ -f "$CONFIG" ] && command -v python3 &>/dev/null; then
  PORT=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('camofox',{}).get('port',9377))" 2>/dev/null || echo 9377)
  API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('camofox',{}).get('apiKey','pocketai'))" 2>/dev/null || echo pocketai)
else
  PORT=9377
  API_KEY=pocketai
fi

mkdir -p "$COOKIE_DIR"

case "$ACTION" in
  export)
    echo "Exporting cookies for userId=$USER_ID → $FILE"
    curl -s -H "Authorization: Bearer $API_KEY" "http://localhost:$PORT/sessions/$USER_ID/cookies" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'cookies' in d:
    with open('$FILE', 'w') as f:
        json.dump(d['cookies'], f, indent=2)
    print(f'✅ Exported {len(d[\"cookies\"])} cookies')
else:
    print(f'❌ Error: {d.get(\"error\", \"unknown\")}')
    sys.exit(1)
"
    ;;
  import)
    echo "Importing cookies for userId=$USER_ID ← $FILE"
    if [ ! -f "$FILE" ]; then
      echo "❌ File not found: $FILE"
      exit 1
    fi
    COOKIES=$(cat "$FILE")
    curl -s -X POST "http://localhost:$PORT/sessions/$USER_ID/cookies" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $API_KEY" \
      -d "{\"cookies\": $COOKIES}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('ok'):
    print(f'✅ Imported {d.get(\"count\", 0)} cookies')
else:
    print(f'❌ Error: {d.get(\"error\", \"unknown\")}')
"
    ;;
  *)
    echo "Usage: $0 [export|import] <userId> [file]"
    ;;
esac
