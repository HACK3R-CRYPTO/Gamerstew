import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useDisconnect } from 'wagmi';
import AccountModal from './AccountModal';

function Navigation() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const { login, logout, authenticated, user, exportWallet } = usePrivy();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();

  const handleLogout = () => {
    logout();
    disconnect();
  };

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024 && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileMenuOpen]);

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const isActivePath = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path);
  };

  const privyWallet = user?.wallet?.address;
  const displayAddr = address || privyWallet;
  const displayName = user?.email?.address || (displayAddr ? formatAddress(displayAddr) : '');

  const navLinks = [
    { path: '/', label: 'Games' },
    { path: '/arena', label: 'Arena' },
    { path: '/leaderboard', label: 'Scores' },
    { path: 'https://celoscan.io/token/0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', label: 'G$', external: true }
  ];

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 bg-[#050505] backdrop-blur-md border-b border-white/5">
      <div className="max-w-[1000px] mx-auto flex items-center justify-between">

        <Link to="/" className="flex items-center gap-3 group no-underline">
          <img src="/logo.png" alt="GameArena" className="w-8 h-8 rounded" />
          <span className="font-mono text-lg font-bold text-white tracking-tight">
            GAMEARENA
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            link.external ? (
              <a
                key={link.path}
                href={link.path}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm tracking-wide text-purple-400 hover:text-purple-300 transition-colors"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.path}
                to={link.path}
                className={`font-mono text-sm tracking-wide transition-colors ${isActivePath(link.path)
                  ? 'text-purple-400'
                  : 'text-gray-500 hover:text-white'
                  }`}
              >
                {link.label}
              </Link>
            )
          ))}
        </div>

        <div className="hidden md:flex items-center gap-4">
          {authenticated ? (
            <button
              onClick={() => setShowAccount(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:border-purple-500/30 transition-colors cursor-pointer"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
              <span className="font-mono text-xs text-gray-300 truncate max-w-[120px]">
                {displayName}
              </span>
            </button>
          ) : (
            <button
              className="btn-primary px-5 py-2 rounded text-sm font-bold font-mono"
              onClick={login}
            >
              CONNECT
            </button>
          )}
        </div>

        <button
          className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <svg
            className={`w-6 h-6 transition-transform duration-300 ${mobileMenuOpen ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      <div
        className={`md:hidden absolute left-4 right-4 top-[80px] transition-all duration-300 ease-out origin-top ${mobileMenuOpen
          ? 'transform scale-y-100 opacity-100 visible'
          : 'transform scale-y-95 opacity-0 invisible'
          }`}
      >
        <div className="p-4 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-purple-500/20 bg-[#0a0a14]">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              link.external ? (
                <a
                  key={link.path}
                  href={link.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-3 rounded-lg font-mono text-sm text-gray-400 hover:bg-white/5 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-4 py-3 rounded-lg font-mono text-sm ${isActivePath(link.path)
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              )
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10">
            {authenticated ? (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => { setShowAccount(true); setMobileMenuOpen(false); }}
                  className="flex items-center justify-between px-3 py-2 bg-black/40 rounded-lg border border-white/5 hover:border-purple-500/30 transition-colors"
                >
                  <span className="font-mono text-sm text-purple-300">{displayName}</span>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </button>
                <button
                  className="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400 font-mono text-xs uppercase tracking-wider hover:bg-red-500/10 transition-colors"
                  onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                >
                  Log Out
                </button>
              </div>
            ) : (
              <button
                className="w-full btn-primary py-3 rounded-lg font-bold font-mono"
                onClick={() => { login(); setMobileMenuOpen(false); }}
              >
                CONNECT
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
    {showAccount && <AccountModal isOpen={showAccount} onClose={() => setShowAccount(false)} />}
    </>
  );
}

export default Navigation;
