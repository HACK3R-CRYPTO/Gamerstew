const { createWalletClient, http, publicActions, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { celo } = require('viem/chains');
require('dotenv').config();

// Season 1 payout · generous-mode allocation (5,400 G$ across 8 wallets).
// Sends G$ (GoodDollar) from the agent wallet to each Season 1 prize
// recipient. Sequential with explicit nonces so a stuck Forno node
// doesn't double-spend or block the rest of the batch.
//
// SAFETY: dry-run by default. To actually send, run with:
//   PAYOUT_CONFIRM=yes node season1_payout.cjs

const G_TOKEN = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A';
const ERC20_ABI = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint8' }] },
];

// Season 1 generous-mode allocation · 5,400 G$ total.
// Per-row total = Solo Ladder share + Team Wars share, summed so each
// recipient gets one tx instead of two.
const PAYOUTS = [
  { name: 'cornensecornelia', wallet: '0x307d3f9657b67dc60b7d99b4d9a8734ce5e63b90', amount: 1050, note: 'Solo #1 (600) + Alpha qualifier (450)' },
  { name: 'VICK_1_TORR',      wallet: '0x92f2399940e928dfb78b01dbe1fe5831d2151628', amount: 850,  note: 'Solo #2 (400) + Alpha qualifier (450)' },
  { name: 'NIAR21',           wallet: '0x6aed964ad8b0432b5ff4b661813981c6b75cb5e3', amount: 800,  note: 'Solo #3 (200) + Pulse qualifier (600)' },
  { name: 'bisi_001',         wallet: '0xf315ac6a685d8fe0f433cfc8daa21ebb29b63be1', amount: 600,  note: 'Pulse qualifier' },
  { name: 'Curiouscat',       wallet: '0x77a61f945354f6bce96c843a2c32ba9b4deeec3b', amount: 600,  note: 'Pulse qualifier' },
  { name: 'Daniel001',        wallet: '0xaa4d3c73dbce53cadd010d3e1cccc30f865a9550', amount: 600,  note: 'Pulse qualifier' },
  { name: 'Ackerman',         wallet: '0xaca0db3a7ff0b7f1c94fd7b89392c90890878466', amount: 450,  note: 'Nova qualifier' },
  { name: 'ahim',             wallet: '0x1a29c636599a5b4f635f05d233959775b88c72e4', amount: 450,  note: 'Nova qualifier' },
];

async function main() {
  if (!process.env.PRIVATE_KEY) { console.error('Missing PRIVATE_KEY in env'); process.exit(1); }
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const client = createWalletClient({
    account, chain: celo, transport: http(process.env.CELO_RPC_URL || 'https://forno.celo.org'),
  }).extend(publicActions);

  const decimals = await client.readContract({ address: G_TOKEN, abi: ERC20_ABI, functionName: 'decimals' });
  const balBefore = await client.readContract({ address: G_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  const totalNeeded = PAYOUTS.reduce((s, p) => s + p.amount, 0);

  console.log('=== Season 1 payout · generous mode ===');
  console.log('Sender:', account.address);
  console.log('Balance:', formatUnits(balBefore, decimals), 'G$');
  console.log('Total to send:', totalNeeded, 'G$');
  console.log();
  console.log('Recipients (' + PAYOUTS.length + '):');
  for (const p of PAYOUTS) {
    console.log('  ' + p.name.padEnd(20) + ' ' + p.wallet + ' · ' + p.amount + ' G$  (' + p.note + ')');
  }
  console.log();

  if (parseUnits(String(totalNeeded), decimals) > balBefore) {
    console.error('Insufficient G$ balance. Top up the sender wallet first.');
    process.exit(1);
  }

  const confirm = (process.env.PAYOUT_CONFIRM || '').toLowerCase();
  if (confirm !== 'yes' && confirm !== '1' && confirm !== 'true') {
    console.log('DRY RUN · no transactions will be sent.');
    console.log('To execute, re-run with: PAYOUT_CONFIRM=yes node season1_payout.cjs');
    return;
  }

  console.log('PAYOUT_CONFIRM set · sending in 5 seconds. Ctrl-C to abort.');
  await new Promise(r => setTimeout(r, 5000));

  // Sequential with auto nonce. viem's writeContract reads the next nonce
  // each call; gap between calls is the receipt wait so concurrent races
  // are not a concern. Errors logged but don't break the loop.
  let ok = 0, fail = 0;
  for (const p of PAYOUTS) {
    const amountWei = parseUnits(String(p.amount), decimals);
    try {
      const hash = await client.writeContract({
        address: G_TOKEN, abi: ERC20_ABI, functionName: 'transfer',
        args: [p.wallet, amountWei],
      });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status === 'success') {
        ok++;
        console.log('✅ ' + p.name.padEnd(20) + ' ' + p.amount + ' G$ · ' + hash);
      } else {
        fail++;
        console.warn('✗ ' + p.name + ' reverted · ' + hash);
      }
    } catch (e) {
      fail++;
      console.warn('✗ ' + p.name + ' errored · ' + (e?.shortMessage ?? e?.message ?? e));
    }
  }

  const balAfter = await client.readContract({ address: G_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  console.log();
  console.log('Done. Sent ' + ok + '/' + PAYOUTS.length + ' · failed ' + fail);
  console.log('Balance after:', formatUnits(balAfter, decimals), 'G$');
}

main().catch(e => { console.error(e); process.exit(1); });
