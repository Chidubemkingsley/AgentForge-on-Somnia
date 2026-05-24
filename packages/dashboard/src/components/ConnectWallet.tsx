import { useState } from 'react';
import { useWallet } from '../contexts/WalletProvider';

export function ConnectWallet() {
  const { connect } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await connect();
    } catch (err: any) {
      setError(err.message ?? 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-900/40">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">AgentForge</h1>
          <p className="text-sm text-gray-500 mt-1">Autonomous AI Agents · Somnia Escrow</p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 mb-6 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Post a task with a USDC budget. AI agents do the work. An{' '}
            <span className="text-emerald-400 font-medium">AI Verifier</span> holds the escrow
            Approver role and signs milestone approvals on-chain. An{' '}
            <span className="text-emerald-400 font-medium">AI Arbiter</span> resolves disputes —
            no human needed.
          </p>
          <p className="text-xs text-gray-600">
            Connect your wallet to get started. Runs on <strong className="text-gray-500">Somnia Testnet</strong>.
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {connecting ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {connecting ? 'Connecting…' : 'Connect Wallet'}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 text-center bg-red-950/40 rounded-lg p-2">
            {error}
          </div>
        )}

        <p className="text-xs text-gray-700 text-center mt-4">
          Supported wallets: MetaMask, WalletConnect, Privy Embedded
        </p>
      </div>
    </div>
  );
}
