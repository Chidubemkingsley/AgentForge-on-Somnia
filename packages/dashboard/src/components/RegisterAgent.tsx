import { useState } from 'react';
import { PlusCircle, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';

const REGISTRY_URL = '/api';

const EMPTY_FORM = {
  agent_id: '',
  name: '',
  description: '',
  capabilities: '',
  payment_model: 'free',
  price_per_call: '0.02',
  endpoint: '',
  evm_address: '',
  health_check: '',
};

function validateForm(form: typeof EMPTY_FORM): string | null {
  if (!form.agent_id.match(/^[a-z0-9-]+$/))
    return 'Agent ID must be lowercase letters, numbers, and hyphens only';
  if (!form.name.trim()) return 'Display name is required';
  if (!form.endpoint.startsWith('http'))
    return 'Endpoint must be a valid URL starting with http(s)://';
  if (!form.evm_address.match(/^0x[a-fA-F0-9]{40}$/))
    return 'EVM address must start with 0x and be 42 characters';
  if (!form.capabilities.trim()) return 'At least one capability is required';
  const price = parseFloat(form.price_per_call);
  if (isNaN(price) || price <= 0) return 'Price must be a positive number';
  return null;
}

export function RegisterAgent() {
  const { publicKey, signMessage } = useWallet();
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const update = (key: string, val: string | boolean) => {
    setForm(f => ({ ...f, [key]: val }));
    if (status === 'error') setStatus('idle');
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setStatus('idle');
    setMessage('');
  };

  const handleSubmit = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setStatus('error');
      setMessage(validationError);
      return;
    }

    setStatus('loading');
    try {
      const signMessageText = `Register agent ${form.agent_id} at EVM address ${form.evm_address}`;
      let signature: string | undefined;
      try {
        signature = await signMessage(signMessageText);
      } catch {
        setStatus('error');
        setMessage('Signing cancelled or failed — you must sign the registration message with your wallet.');
        return;
      }

      const manifest = {
        agent_id: form.agent_id,
        name: form.name,
        description: form.description,
        capabilities: form.capabilities.split(',').map(s => s.trim()).filter(Boolean),
        pricing: {
          model: form.payment_model,
          price_per_call: parseFloat(form.price_per_call),
          currency: 'USDC',
        },
        endpoint: form.endpoint,
        evm_address: form.evm_address,
        health_check: form.health_check || `${form.endpoint.replace(/\/[^/]*$/, '')}/health`,
        registered_by: publicKey ?? undefined,
        signature,
        signed_message: signMessageText,
      };

      const res = await fetch(`${REGISTRY_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });

      if (res.ok) {
        setStatus('success');
        setMessage(`${form.name} registered successfully! Wallet signature verified on-chain. The agent will appear in the list and be available for tasks immediately.`);
      } else {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus('error');
        setMessage(err.error ?? 'Registration failed');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(`Could not reach registry: ${e.message}`);
    }
  };

  const canSubmit = status !== 'loading' &&
    form.agent_id.trim() !== '' &&
    form.endpoint.trim() !== '' &&
    form.evm_address.trim() !== '';

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <PlusCircle size={18} className="text-emerald-400" />
          <h2 className="text-base font-semibold text-gray-200">Register Agent</h2>
        </div>

        {status === 'success' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-green-950 border border-green-800 rounded-lg p-4">
              <Check size={16} className="text-green-400 mt-0.5 shrink-0" />
              <p className="text-sm text-green-300">{message}</p>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              <RefreshCw size={14} />
              Register Another Agent
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {[
                { key: 'agent_id', label: 'Agent ID', placeholder: 'my-agent (lowercase, hyphens ok)' },
                { key: 'name', label: 'Display Name', placeholder: 'MyBot' },
                { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://my-server.com/query' },
                { key: 'health_check', label: 'Health Check URL (optional)', placeholder: 'auto-derived from endpoint if blank' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key as keyof typeof form] as string}
                    onChange={e => update(key, e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs text-gray-400 mb-1">EVM Address (0x...)</label>
                <input
                  type="text"
                  value={form.evm_address}
                  onChange={e => update('evm_address', e.target.value)}
                  placeholder="0x... (42 characters)"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  placeholder="What does your agent do?"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Capabilities (comma-separated)</label>
                <input
                  type="text"
                  value={form.capabilities}
                  onChange={e => update('capabilities', e.target.value)}
                  placeholder="news, translation, data-analysis"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Payment Model</label>
                  <select
                    value={form.payment_model}
                    onChange={e => update('payment_model', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="free">free</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price per call (USDC)</label>
                  <input
                    type="number"
                    value={form.price_per_call}
                    onChange={e => update('price_per_call', e.target.value)}
                    step={0.001}
                    min={0}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {status === 'error' && (
              <div className="mt-4 flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg p-3">
                <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <span className="text-sm text-red-300">{message}</span>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {(status === 'error' || form.agent_id) && (
                <button
                  onClick={reset}
                  className="px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
              >
                {status === 'loading' ? 'Registering...' : 'Register Agent'}
              </button>
            </div>
          </>
        )}

        <div className="mt-4 pt-4 border-t border-gray-800">
          <p className="text-xs text-gray-600">
            Your agent must implement <code className="text-gray-500">GET /health</code> and a POST endpoint accepting
            {' '}&#123; instruction, context &#125; returning &#123; result &#125;. Payment comes via Somnia escrow release — no payment middleware needed.
          </p>
        </div>
      </div>
    </div>
  );
}
