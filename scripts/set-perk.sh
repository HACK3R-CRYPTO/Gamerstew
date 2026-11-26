#!/usr/bin/env bash
# Switch a shop item on, or change its price.
#
#   scripts/set-perk.sh <item number> <price in G$>
#   scripts/set-perk.sh 9 100        # "One more life" in UP NEPA 3D, at 100 G$
#   scripts/set-perk.sh 9 0          # take it off sale again
#
# Only the wallet that owns the shop contract can do this. The script shows who
# that is and what the item costs now, asks you to confirm, then asks for that
# wallet's private key. The key is typed hidden, is not saved anywhere and never
# appears in your terminal history.
#
# The app reads the price from the contract, so the item appears in the game by
# itself a few minutes after this succeeds. Nothing needs to be deployed.
set -euo pipefail

SHOP="${PERK_SHOP:-0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5}"
RPC="${CELO_RPC_URL:-https://forno.celo.org}"

if [ $# -ne 2 ] || ! [[ "$1" =~ ^[0-9]+$ ]] || ! [[ "$2" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "Use it like this:  scripts/set-perk.sh <item number> <price in G\$>     e.g.  scripts/set-perk.sh 9 100"
  exit 1
fi
command -v cast >/dev/null || { echo "This needs Foundry's 'cast'. Install it with:  curl -L https://foundry.paradigm.xyz | bash && foundryup"; exit 1; }

id="$1"; price="$2"
owner=$(cast call "$SHOP" "owner()(address)" --rpc-url "$RPC")
now_wei=$(cast call "$SHOP" "perkPrice(uint16)(uint256)" "$id" --rpc-url "$RPC" | awk '{print $1}')
now=$(cast from-wei "$now_wei")
new_wei=$(cast to-wei "$price")

echo
echo "  Shop contract    $SHOP  (Celo)"
echo "  Its owner        $owner"
echo "  Item $id now      $( [ "$now_wei" = "0" ] && echo "not on sale" || echo "$now G\$" )"
echo "  Item $id will be  $( [ "$new_wei" = "0" ] && echo "not on sale" || echo "$price G\$" )"
echo
read -r -p "  Type yes to send this from the owner wallet: " ok
[ "$ok" = "yes" ] || { echo "  Nothing was sent."; exit 0; }

echo "  Paste the OWNER wallet's private key and press Enter (it will not show on screen)."
cast send "$SHOP" "setPerk(uint16,uint256,bool)" "$id" "$new_wei" false --rpc-url "$RPC" --interactive

after=$(cast call "$SHOP" "perkPrice(uint16)(uint256)" "$id" --rpc-url "$RPC" | awk '{print $1}')
echo
if [ "$after" = "$new_wei" ]; then echo "  Done. Item $id is now $( [ "$new_wei" = "0" ] && echo "off sale" || echo "$price G\$" )."; else echo "  The price did not change. Was that the owner wallet's key? The owner is $owner"; exit 1; fi
