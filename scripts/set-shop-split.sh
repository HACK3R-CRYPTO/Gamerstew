#!/usr/bin/env bash
# Change how the shop contract splits every sale between the GoodDollar UBI pool
# and the GameArena treasury. This applies to EVERY shop item, not only energy.
#
#   scripts/set-shop-split.sh <percent to the UBI pool>
#   scripts/set-shop-split.sh 10        # 10% to UBI, 90% to the treasury
#
# Only the wallet that owns the shop contract can do this. It shows the split
# now, asks you to confirm, then asks for that wallet's private key (typed
# hidden, never saved).
set -euo pipefail
SHOP="${PERK_SHOP:-0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5}"
RPC="${CELO_RPC_URL:-https://forno.celo.org}"
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[0-9]+$ ]] || [ "$1" -gt 100 ]; then
  echo "Use it like this:  scripts/set-shop-split.sh <percent to the UBI pool, 0 to 100>     e.g.  scripts/set-shop-split.sh 10"; exit 1
fi
command -v cast >/dev/null || { echo "This needs Foundry's 'cast'. Install it with:  curl -L https://foundry.paradigm.xyz | bash && foundryup"; exit 1; }
ubi=$(( $1 * 100 )); treasury=$(( 10000 - ubi ))
owner=$(cast call "$SHOP" "owner()(address)" --rpc-url "$RPC")
now=$(cast call "$SHOP" "ubiBps()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
echo
echo "  Shop contract   $SHOP  (Celo)"
echo "  Its owner       $owner"
echo "  Split now       $(( now / 100 ))% UBI pool, $(( (10000 - now) / 100 ))% treasury"
echo "  Split after     $1% UBI pool, $(( 100 - $1 ))% treasury     (every shop item)"
echo
read -r -p "  Type yes to send this from the owner wallet: " ok
[ "$ok" = "yes" ] || { echo "  Nothing was sent."; exit 0; }
echo "  Paste the OWNER wallet's private key and press Enter (it will not show on screen)."
cast send "$SHOP" "setSplit(uint256,uint256)" "$ubi" "$treasury" --rpc-url "$RPC" --interactive
after=$(cast call "$SHOP" "ubiBps()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
echo; if [ "$after" = "$ubi" ]; then echo "  Done. $1% of every sale now goes to the UBI pool."; else echo "  The split did not change. Was that the owner wallet's key? The owner is $owner"; exit 1; fi
