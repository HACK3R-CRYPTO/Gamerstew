import { Buffer } from 'buffer';
import process from 'process';

window.Buffer = Buffer;
window.process = process;

// Fix for React Query caching crashing on BigInts when using @privy-io/wagmi createConfig
if (typeof BigInt !== "undefined" && !(BigInt.prototype).toJSON) {
  (BigInt.prototype).toJSON = function () {
    return this.toString();
  };
}
