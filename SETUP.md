# AgentForge-on-Somnia — Local Setup & Testing Guide

## Prerequisites

| Tool | Required version | Check |
|---|---|---|
| Node.js | 20+ | `node --version` |
| npm | 10+ | `npm --version` |
| Git | any | `git --version` |

Install Node 20 if needed:
```bash
nvm install 20 && nvm use 20
```

---

## 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/agentforge-on-somnia.git
cd agentforge-on-somnia
npm install
```

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

### Required immediately:
```
GROQ_API_KEY=    # Get a free key from https://console.groq.com
```

### EVM wallet keys (generated in step 3):
```
PLATFORM_PRIVATE_KEY=0x...
VERIFIER_PRIVATE_KEY=0x...
ARBITER_PRIVATE_KEY=0x...
SOMNIA_ORACLE_PRIVATE_KEY=0x...
WEB_INTEL_PRIVATE_KEY=0x...
WEB_INTEL_V2_PRIVATE_KEY=0x...
ANALYSIS_AGENT_PRIVATE_KEY=0x...
REPORT_AGENT_PRIVATE_KEY=0x...
```

---

## 3. Generate & Fund Wallets

Generate 8 EVM private keys (Platform, Verifier, Arbiter + 5 agents). You can use any EVM wallet generator or:

```bash
node -e "const w=require('ethers').Wallet.createRandom(); console.log('0x'+w.privateKey)"
```

Copy the printed `0x...` keys into your `.env`.

Fund the Platform wallet with testnet SOMNIA for gas and testnet USDC from the Somnia faucet.

---

## 4. Compile & Test Smart Contracts

```bash
npm run contracts:compile
npm run contracts:test
```

Expected output: **23 passing** (test deployment, funding, milestone lifecycle, disputes, access control, view functions).

---

## 5. Deploy Escrow Contract (Optional — skip if already deployed)

```bash
npm run contracts:deploy
```

This deploys `AgentForgeEscrow.sol` to Somnia Testnet. The deployed address is printed and should be set as `ESCROW_CONTRACT_ADDRESS` in `.env`.

---

## 6. Start the Application

```bash
./scripts/start.sh
```

Then open: **http://localhost:3000**

To stop:
```bash
./scripts/stop.sh
```

---

## 7. Seed Reputation Data (Optional but recommended for demos)

```bash
npm run bootstrap
```

This seeds the agent registry with historical reputation scores so the agent selection panel looks populated.

---

## 8. What to Test

### Test A — Basic task submission
1. Open http://localhost:3000
2. Enter task: `"Check the latest Somnia network stats and gas prices"`
3. Budget: `0.2`
4. Click **Run Task**
5. Watch the **Live Activity** feed — you'll see:
   - `feasibility_checked` → `plan_created` → `plan_approval_required` (auto-approves in 60s)
   - `escrow_deployed` + contract address
   - `escrow_funded` (platform wallet auto-funds)
   - `milestone_started` → `agent_output` → `milestone_marked` (on-chain tx hash)
   - `verifying` → `verified` (AI Verifier reasoning appears)
   - `milestone_released` (funds sent to agent) OR dispute path

### Test B — Approve/reject a plan manually (human-in-the-loop)
1. Submit a task
2. When `plan_approval_required` appears, click **Review Plan** in the dashboard
3. Read the milestones + acceptance criteria
4. Click **Approve** or **Reject**
5. The pipeline continues or stops based on your choice

### Test C — Human-override (you become the Approver)
1. Toggle **"Human-in-the-loop"** switch in the task form
2. Submit a task
3. After the agent marks a milestone done, you'll be prompted to approve it
4. Funds release

### Test D — Verifier rejects bad work → Arbiter resolves
1. Submit a task where the agent is likely to produce incomplete output
   (e.g., `"Write a 500-word essay on blockchain with full citations and diagrams"`)
2. The AI Verifier will reject partial work
3. The system auto-contests via `dispute_started` (on-chain tx hash)
4. The AI Arbiter weighs the evidence and resolves with a percentage split
5. `dispute_resolved` appears with on-chain tx hash and the Arbiter's reasoning

### Test E — Bootstrap then check reputation
```bash
npm run bootstrap
```
Then open http://localhost:3000 → Agents tab — agents should show reputation scores > 50.

---

## 9. Verifying On-Chain Proof

Every task result includes:
- **Escrow contract address** — the deployed `AgentForgeEscrow` on Somnia Testnet
- **Tx hashes** — each lifecycle action has a Somnia transaction hash

Inspect transactions on the [Somnia Testnet Explorer](https://testnet.somnia.network).

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `GROQ_API_KEY not set` | Get a free key from https://console.groq.com |
| Services won't start | Run `./scripts/stop.sh` first, then `./scripts/start.sh` |
| Agents not registering | Registry must start first — check `logs/registry.log` |
| Verifier always rejects | Normal — it's honest. Check acceptance criteria in the plan |
| `tsx` not found | Run `npm install` from repo root |
| Node version error | `nvm use 20` |
| `approve` keeps reverting | Somnia rejects `gasLimit` below ~1,036,082 on USDC `approve`. Dashboard defaults to `0x200000`. If calling directly, use a gas limit ≥ 1,100,000 or omit it. |

**Check service logs:**
```bash
tail -f logs/orchestrator.log   # main activity
tail -f logs/registry.log       # agent registration
tail -f logs/analysis.log       # agent errors
```

---

## 11. Environment Variables Reference

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key (`llama-3.1-8b-instant`) — for planner, verifier, arbiter, agents |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID for wallet auth |
| `PLATFORM_PRIVATE_KEY` | Platform wallet — signs deploy, release; receives platform fee |
| `VERIFIER_PRIVATE_KEY` | AI Verifier wallet — holds Approver role |
| `ARBITER_PRIVATE_KEY` | AI Arbiter wallet — holds Dispute Resolver role |
| `SOMNIA_RPC_URL` | Somnia RPC endpoint (default: `https://api.infra.testnet.somnia.network`) |
| `USDC_CONTRACT_ADDRESS` | USDC token address on Somnia |
| `ESCROW_CONTRACT_ADDRESS` | Deployed AgentForgeEscrow contract address |
| `ORCHESTRATOR_PORT` | Default `3000` |
| `REGISTRY_PORT` | Default `4000` |
| `PLAN_APPROVAL_TIMEOUT_MS` | Default `60000` — auto-approves plans after this |
| `DEFAULT_BUDGET` | Default task budget if not specified |

---

## 12. Architecture Quick Reference

```
Human → post task + budget
      ↓
Orchestrator (port 3000)
  ├── Groq planner → milestones with acceptance criteria
  ├── deploy Escrow → AgentForgeEscrow on Somnia EVM
  ├── fund Escrow → USDC locked in contract
  └── for each milestone:
       ├── Agent does work → markMilestone on-chain
       ├── AI Verifier evaluates → approveMilestone on-chain
       ├── Platform releases → releaseMilestone → USDC to agent
       └── [if rejected] dispute → startDispute on-chain
                         arbiter → resolveDispute with split

Registry (port 4000)  — agent discovery + reputation
Agents (4001–4005)    — SomniaOracle, WebIntel, WebIntelV2, AnalysisBot, ReporterBot
Dashboard             — served from port 3000
```
