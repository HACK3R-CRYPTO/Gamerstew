#!/usr/bin/env bash
# Tell GoodCash where to send the news of each cash out, and get the secret that
# proves the news is really theirs. Run it once for test keys and once for live.
#
#   GOODCASH_SECRET_KEY=gc_sk_test_... ./scripts/goodcash-webhook.sh
#
# The secret key is read from the environment so it never lands in your shell
# history or in a chat. GoodCash answers with a "secret" (whsec_...) ONCE:
# put it on the game server (Railway) as GOODCASH_WEBHOOK_SECRET.
# Lost it? Run this again with ROTATE=1 to get a new one.
set -euo pipefail
: "${GOODCASH_SECRET_KEY:?Set GOODCASH_SECRET_KEY to your gc_sk_test_... or gc_sk_live_... key}"
case "$GOODCASH_SECRET_KEY" in gc_sk_test_*|gc_sk_live_*) ;; *) echo "That does not look like a GoodCash secret key (gc_sk_test_... or gc_sk_live_...)." >&2; exit 1 ;; esac
URL="${WEBHOOK_URL:-https://game-backend-production-6130.up.railway.app/api/goodcash/webhook}"
BODY="{\"url\":\"$URL\"$([ "${ROTATE:-0}" = "1" ] && echo ',"rotateSecret":true')}"
echo "Setting the webhook to: $URL"
curl -sS -X PUT https://api.goodcash.xyz/v1/webhooks -H "Authorization: Bearer $GOODCASH_SECRET_KEY" -H "Content-Type: application/json" -d "$BODY"
echo
echo "If you see a \"secret\" above (whsec_...), copy it now: it is shown once."
echo "Set it on Railway as GOODCASH_WEBHOOK_SECRET, then send a test event:"
echo "  curl -X POST https://api.goodcash.xyz/v1/webhooks/test -H \"Authorization: Bearer \$GOODCASH_SECRET_KEY\""
