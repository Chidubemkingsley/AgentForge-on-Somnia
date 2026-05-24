import { useState } from 'react';
import { AlertTriangle, CheckCircle, X, ExternalLink, DollarSign, Zap, Wallet } from 'lucide-react';
import { confirmFunding } from '../lib/api';
import { useWallet } from '../contexts/WalletProvider';

function waitForTx(txHash: string, maxWaitMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = async () => {
      try {
        const res = await fetch('https://api.infra.testnet.somnia.network', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getTransactionReceipt',
            params: [txHash],
            id: 1,
          }),
        });
        const data = await res.json();
        if (data?.result?.status === '0x1') return resolve();
        if (data?.result?.status === '0x0') return reject(new Error('Transaction reverted'));
      } catch {}
      if (Date.now() - start > maxWaitMs) return reject(new Error('Timeout waiting for tx'));
      setTimeout(poll, 1000);
    };
    poll();
  });
}

interface Props {
  taskId: string;
  escrowAddress: string;
  explorerUrl: string;
  totalUsdc: number;
  usdcContractAddress?: string;
  escrowContractAddress?: string;
  encodedApproveData?: string;
  encodedFundData?: string;
  amountHex?: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function FundingPrompt({
  taskId,
  escrowAddress,
  explorerUrl,
  totalUsdc,
  usdcContractAddress,
  escrowContractAddress,
  encodedApproveData,
  encodedFundData,
  amountHex,
  onConfirm,
  onDismiss,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWallet();

  const fundFromWallet = async () => {
    if (!wallet.isConnected) {
      setError('Connect your wallet first');
      return;
    }
    if (!usdcContractAddress || !encodedApproveData || !encodedFundData) {
      setError('Missing encoded transaction data from server');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const approveHash = await wallet.sendTransaction({
        to: usdcContractAddress,
        data: encodedApproveData,
      });
      console.log('Approve sent:', approveHash);
      await waitForTx(approveHash);
      console.log('Approve confirmed');

      const fundHash = await wallet.sendTransaction({
        to: escrowContractAddress || escrowAddress,
        data: encodedFundData,
      });
      console.log('Fund sent:', fundHash);
      await waitForTx(fundHash);
      console.log('Fund confirmed');

      await confirmFunding(taskId, {});
      onConfirm();
    } catch (err: any) {
      setError(err.message ?? 'Transaction failed');
    } finally {
      setBusy(false);
    }
  };

  const fundFromPlatform = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmFunding(taskId, { usePlatformFunds: true });
      onConfirm();
    } catch (err: any) {
      setError(err.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-amber-900/40 rounded-2xl p-5 space-y-4 shadow-2xl">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-600/20 border border-amber-600/40 rounded-md flex items-center justify-center">
              <DollarSign size={12} className="text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Fund the Escrow</p>
              <p className="text-xs text-gray-500">Your USDC locks until agents deliver</p>
            </div>
          </div>
          <button onClick={onDismiss} disabled={busy} className="text-gray-600 hover:text-gray-400 disabled:opacity-40">
            <X size={14} />
          </button>
        </div>

        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl px-4 py-3 text-center">
          <p className="text-2xl font-bold text-white">
            {totalUsdc.toFixed(4)} <span className="text-amber-400">USDC</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">locked in escrow — released per milestone on verification</p>
        </div>

        <div className="space-y-1.5">
          {[
            'Funds locked in AgentForge escrow contract on Somnia',
            'Agents paid only when AI Verifier confirms acceptance criteria',
            'Disputed or failed milestone funds return to platform',
          ].map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
              <CheckCircle size={9} className="text-emerald-500 mt-0.5 shrink-0" />
              {line}
            </div>
          ))}
        </div>

        <div className="bg-gray-950/60 rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-600 mb-0.5">Escrow contract</p>
            <p className="text-xs text-gray-400 font-mono truncate">{escrowAddress}</p>
          </div>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer"
              className="shrink-0 text-emerald-400 hover:text-emerald-300 transition-colors">
              <ExternalLink size={12} />
            </a>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2 leading-relaxed">{error}</p>
        )}

        <button
          onClick={fundFromWallet}
          disabled={busy || !wallet.isConnected}
          className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
        >
          {busy ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Wallet size={12} />
          )}
          {busy ? 'Processing…' : `Fund ${totalUsdc.toFixed(4)} USDC from your wallet`}
        </button>

        {wallet.isConnected && (
          <button
            onClick={fundFromPlatform}
            disabled={busy}
            className="w-full py-2 rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 text-gray-400 hover:text-gray-300 text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <Zap size={12} />
            Fund with platform wallet (no wallet prompt)
          </button>
        )}

        <button
          onClick={onDismiss}
          disabled={busy}
          className="w-full py-1.5 text-xs text-gray-700 hover:text-gray-500 disabled:opacity-40 transition-colors"
        >
          Cancel task
        </button>
      </div>
    </div>
  );
}
