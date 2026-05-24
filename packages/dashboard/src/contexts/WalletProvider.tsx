import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  PrivyProvider,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth';

interface WalletContextValue {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (tx: string) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
  sendTransaction: (params: { to: string; data: string; gas?: string }) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const LS_PUBKEY = 'agentforge_pubkey';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

function WalletContextInner({ children }: { children: ReactNode }) {
  const { login, logout, ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    const saved = localStorage.getItem(LS_PUBKEY);
    if (authenticated && wallets.length > 0) {
      const addr = wallets[0].address;
      setPublicKey(addr);
      localStorage.setItem(LS_PUBKEY, addr);
    } else if (!authenticated && saved) {
      localStorage.removeItem(LS_PUBKEY);
      setPublicKey(null);
    }
    setIsLoading(false);
  }, [ready, authenticated, wallets]);

  const connect = useCallback(async () => {
    await login();
  }, [login]);

  const disconnect = useCallback(() => {
    logout();
    setPublicKey(null);
    localStorage.removeItem(LS_PUBKEY);
  }, [logout]);

  const signTransaction = useCallback(async (tx: string): Promise<string> => {
    if (!publicKey || wallets.length === 0) throw new Error('Wallet not connected');
    const wallet = wallets[0];
    const provider = await wallet.getEthereumProvider();
    const result = await provider.request({
      method: 'eth_sign',
      params: [publicKey, tx],
    });
    return result as string;
  }, [publicKey, wallets]);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!publicKey || wallets.length === 0) throw new Error('Wallet not connected');
    const wallet = wallets[0];
    const provider = await wallet.getEthereumProvider();
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(message)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hexMessage = '0x' + bytes;
    const result = await provider.request({
      method: 'personal_sign',
      params: [hexMessage, publicKey],
    });
    return result as string;
  }, [publicKey, wallets]);

  const sendTransaction = useCallback(async (params: { to: string; data: string; gas?: string }): Promise<string> => {
    if (!publicKey || wallets.length === 0) throw new Error('Wallet not connected');
    const wallet = wallets[0];
    const provider = await wallet.getEthereumProvider();
    const txParams: Record<string, string> = { from: publicKey, to: params.to, data: params.data };
    if (params.gas) {
      txParams.gas = params.gas;
    } else {
      txParams.gas = '0x200000'; // safe floor — Somnia reverts approve below ~1,036,082 gas
    }
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    });
    return result as string;
  }, [publicKey, wallets]);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnected: !!publicKey,
        isLoading,
        connect,
        disconnect,
        signTransaction,
        signMessage,
        sendTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    console.warn('[WalletProvider] VITE_PRIVY_APP_ID not set — wallet features disabled');
    return <>{children}</>;
  }

  const somniaTestnet = {
    id: 50312,
    name: 'Somnia Testnet',
    network: 'somnia-testnet',
    nativeCurrency: { name: 'Somnia', symbol: 'SOMNIA', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://api.infra.testnet.somnia.network'] },
      public: { http: ['https://api.infra.testnet.somnia.network'] },
    },
    blockExplorers: {
      default: { name: 'Somnia Explorer', url: 'https://testnet.somnia.network' },
    },
    testnet: true,
  };

  const somniaMainnet = {
    id: 5031,
    name: 'Somnia Mainnet',
    network: 'somnia-mainnet',
    nativeCurrency: { name: 'Somnia', symbol: 'SOMNIA', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://api.infra.mainnet.somnia.network'] },
      public: { http: ['https://api.infra.mainnet.somnia.network'] },
    },
    testnet: false,
  };

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
        defaultChain: somniaTestnet,
        supportedChains: [somniaTestnet, somniaMainnet],
      }}
    >
      <WalletContextInner>{children}</WalletContextInner>
    </PrivyProvider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be inside WalletProvider');
  return ctx;
}
