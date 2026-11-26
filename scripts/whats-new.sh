#!/usr/bin/env bash
# Tell every player what is new: one in-app message (the bell, "From GameArena")
# and one push notification, with one command. Run it after a release is LIVE.
#
#   scripts/whats-new.sh "<bell title>" "<bell text>" "<push title>" "<push text>" [page to open] [short name]
#
#   scripts/whats-new.sh "New: daily pot and living pets" "A pot opens every day..." \
#       "The daily pot is open" "One game a day. The top third split it." /dashboard pot-launch
#
# The same thing can be done with no terminal from the admin: Admin, Announce.
# It shows exactly what will go out and to where, and waits for you to type yes.
# (The push is sent with bell=0: the news is already in the bell, so the push must not add it again.)
# The short name stops the same in-app message being posted twice.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${GAMEARENA_BACKEND:-https://game-backend-production-6130.up.railway.app}"
SECRET="${INTERNAL_SECRET:-$(grep "^INTERNAL_SECRET=" "$ROOT/frontend/.env.local" 2>/dev/null | cut -d= -f2-)}"
[ -n "$SECRET" ] || { echo "No INTERNAL_SECRET found in frontend/.env.local"; exit 1; }
if [ $# -lt 4 ]; then echo 'Use it like this:  scripts/whats-new.sh "<bell title>" "<bell text>" "<push title>" "<push text>" [page] [short name]'; exit 1; fi
BELL_TITLE="$1"; BELL_BODY="$2"; PUSH_TITLE="$3"; PUSH_BODY="$4"; PAGE="${5:-/dashboard}"; KEY="${6:-whats-new-$(date -u +%Y-%m-%d)}"

[ ${#BELL_TITLE} -le 80 ] || { echo "The bell title is ${#BELL_TITLE} characters. The limit is 80."; exit 1; }
[ ${#BELL_BODY} -le 400 ] || { echo "The bell text is ${#BELL_BODY} characters. The limit is 400: it would be cut off. Shorten it."; exit 1; }
echo
echo "  IN THE BELL (every player, under From GameArena)"
echo "    $BELL_TITLE"
echo "    $BELL_BODY"
echo "  PUSH (every device that allowed notifications)   ${#PUSH_TITLE} + ${#PUSH_BODY} characters"
echo "    $PUSH_TITLE"
echo "    $PUSH_BODY"
echo "  Opens: $PAGE        Name: $KEY"
echo
read -r -p "  Is this release live on gamearenahq.xyz? Type yes to send both: " ok
[ "$ok" = "yes" ] || { echo "  Nothing was sent."; exit 0; }

json() { python3 -c 'import json,sys; print(json.dumps(dict(zip(sys.argv[1::2], sys.argv[2::2]))))' "$@"; }
echo "  Bell: $(curl -s -m 30 -X POST "$BACKEND/internal/announce" -H "content-type: application/json" -H "x-internal-secret: $SECRET" -H "Origin: https://gamearenahq.xyz" -d "$(json title "$BELL_TITLE" body "$BELL_BODY" url "$PAGE" kind whats_new dedupeKey "$KEY")")"
echo "  Push: $(curl -s -m 30 -X POST "$BACKEND/api/push/broadcast?bell=0" -H "content-type: application/json" -H "x-internal-secret: $SECRET" -H "Origin: https://gamearenahq.xyz" -d "$(json title "$PUSH_TITLE" body "$PUSH_BODY" url "$PAGE" tag "$KEY")")"
