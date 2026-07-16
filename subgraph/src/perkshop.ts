import { BigInt } from "@graphprotocol/graph-ts";
import { PerkPurchased } from "../generated/PerkShop/PerkShop";
import { PerkPurchase, PerkShopStat } from "../generated/schema";

const ONE = BigInt.fromI32(1);

// Index every on-chain PerkPurchased event: one immutable row per purchase,
// plus a running singleton aggregate. This is the trustless read layer for the
// shop's UBI/purchase analytics — usage (spending a save) stays off-chain.
export function handlePerkPurchased(event: PerkPurchased): void {
  let id = event.transaction.hash.toHex().concat("-").concat(event.logIndex.toString());
  let p = new PerkPurchase(id);
  p.player = event.params.player;
  p.perkId = event.params.perkId;
  p.cosmetic = event.params.cosmetic;
  p.totalPaid = event.params.totalPaid;
  p.ubiAmount = event.params.ubiAmount;
  p.treasuryAmount = event.params.treasuryAmount;
  p.timestamp = event.block.timestamp;
  p.txHash = event.transaction.hash;
  p.save();

  let stat = PerkShopStat.load("global");
  if (stat == null) {
    stat = new PerkShopStat("global");
    stat.totalPurchases = BigInt.zero();
    stat.totalUbiG = BigInt.zero();
    stat.totalTreasuryG = BigInt.zero();
  }
  stat.totalPurchases = stat.totalPurchases.plus(ONE);
  stat.totalUbiG = stat.totalUbiG.plus(event.params.ubiAmount);
  stat.totalTreasuryG = stat.totalTreasuryG.plus(event.params.treasuryAmount);
  stat.lastUpdatedAt = event.block.timestamp;
  stat.save();
}
