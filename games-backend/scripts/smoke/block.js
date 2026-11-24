// Preloaded into the test boot: no connection may leave this machine.
const dns = require('dns');
const real = dns.lookup;
const local = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';
dns.lookup = function (host, opts, cb) { if (typeof opts === 'function') { cb = opts; opts = {}; } if (local(host)) return real.call(dns, host, opts, cb); const e = new Error('blocked by test: ' + host); e.code = 'ENOTFOUND'; process.nextTick(() => cb(e)); };
if (dns.promises) { const rp = dns.promises.lookup; dns.promises.lookup = (host, opts) => (local(host) ? rp.call(dns.promises, host, opts) : Promise.reject(Object.assign(new Error('blocked by test: ' + host), { code: 'ENOTFOUND' }))); }
// freeze the clock's coarse parts so two boots a few seconds apart agree on dates
