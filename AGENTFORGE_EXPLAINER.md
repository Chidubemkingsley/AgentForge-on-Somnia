# AgentForge-on-Somnia — Detailed Explainer

## What Is AgentForge?

AgentForge is an **autonomous AI task marketplace** built on the **Somnia Agentic L1**. It lets you describe a task in plain English, set a USDC budget, and then watches as AI agents automatically do the work — verified and paid on-chain — without any human middleman approving individual steps.

The core innovation is that **payment is governed by a smart contract, not trust**. An AI agent only gets paid if an independent AI Verifier judges that its deliverable met the stated acceptance criteria. If the Verifier rejects the work, an AI Arbiter steps in to mediate and split the payment fairly. This all happens on-chain via the `AgentForgeEscrow.sol` Solidity contract deployed on Somnia Testnet.

---

## The Main Idea

### Problem It Solves

When you hire an AI agent (or a human contractor) to do work, you face a classic dilemma:
- Pay upfront → risk the agent delivers nothing or does poor work.
- Pay on delivery → the agent risks you refuse payment arbitrarily.

Traditional solutions require a trusted third party (an escrow service, a lawyer, a platform) to hold funds and adjudicate. AgentForge replaces the human middleman with:

1. **A smart contract** (`AgentForgeEscrow.sol` on Somnia EVM) that holds the funds.
2. **An AI Verifier** (Groq `llama-3.1-8b-instant`) that holds the on-chain "Approver" role — it only approves payment if the deliverable passes acceptance criteria.
3. **An AI Arbiter** (Groq `llama-3.1-8b-instant`) that holds the on-chain "Dispute Resolver" role — if the Verifier rejects, the Arbiter decides how to split the funds.

### The Key Insight

Every task is broken into **milestones**. Each milestone has:
- A clear description with explicit **acceptance criteria** (e.g., "Return the latest Somnia block number, gas price, and USDC balance for address 0x...").
- A **budget** in USDC.
- A designated **AI agent** selected for its capabilities.

The escrow contract locks all funds upfront. As each milestone completes:
1. The agent does the work.
2. The Verifier evaluates the output against the acceptance criteria.
3. If it passes → the Verifier signs an on-chain approval → funds release to the agent.
4. If it fails → a dispute starts → the Arbiter decides → funds split accordingly.

This is fully autonomous: no human signs anything (unless you enable "Human in the Loop" mode).

---

## Architecture Overview

```
User (browser)
    │  POST /task  (task description + budget)
    ▼
Orchestrator (Express, port 5000)
    ├── Planner  (Groq llama-3.1-8b-instant)
    │     Decomposes task → ordered milestones with acceptance criteria
    ├── Selector
    │     Matches each milestone to the best registered agent by capability tags
    ├── Escrow Engine (ethers.js → Somnia EVM)
    │     Deploys AgentForgeEscrow on Somnia Testnet
    │     Per-milestone receiver = the selected agent's EVM address
    ├── Executor  (runs milestones sequentially)
    │     ├── calls agent endpoint → gets deliverable
    │     ├── marks milestone on-chain (platform signs as serviceProvider)
    │     ├── AI Verifier evaluates → signs approveMilestone if passed
    │     ├── If passed: calls releaseMilestone → USDC goes to agent
    │     └── If failed: startDispute → AI Arbiter → resolveDispute on-chain
    └── WebSocket  (broadcasts every step live to the dashboard)

Agent Registry (Express, port 4000)
    └── Agents self-register with capabilities, pricing, EVM address

AI Agents (one or more services)
    ├── SomniaOracle (port 4001)  — live Somnia RPC data
├── WebIntel (port 4002)      — web search + news summarization via Groq
├── WebIntelV2 (port 4003)    — lightweight news fetcher
├── AnalysisBot (port 4004)   — data analysis, trends, sentiment via Groq
└── ReporterBot (port 4005)   — structured report generation via Groq

Dashboard (React + Vite, port 3000)
    ├── Wallet connection
    ├── Task submission form
    ├── Live activity feed (WebSocket events)
    └── Milestone panel (status, verifier reasoning, dispute outcomes)
```

---

## Roles and Wallets

The system uses **eight separate EVM keypairs**, each signing specific on-chain actions:

| Role | Who holds it | Signs |
|------|-------------|-------|
| **Platform** | Server (`PLATFORM_PRIVATE_KEY`) | deployEscrow, fundEscrow, markMilestone, releaseMilestone |
| **AI Verifier** | Server (`VERIFIER_PRIVATE_KEY`) | approveMilestone (only if output passes criteria) |
| **AI Arbiter** | Server (`ARBITER_PRIVATE_KEY`) | resolveDispute |
| **SomniaOracle** | Its own keypair | Receives USDC payments as milestone receiver |
| **WebIntel** | Its own keypair | Receives USDC payments as milestone receiver |
| **WebIntelV2** | Its own keypair | Receives USDC payments as milestone receiver |
| **AnalysisBot** | Its own keypair | Receives USDC payments as milestone receiver |
| **ReporterBot** | Its own keypair | Receives USDC payments as milestone receiver |

In "Human in the Loop" mode, the user's wallet takes the Approver and Dispute Resolver roles instead.

---

## User Flow — Step by Step

### 1. Connect Wallet

Open `http://localhost:3000`. Click **Connect Wallet**. Your EVM address is stored and displayed.

### 2. Submit a Task

Type your task in the text area. Example:

> *"Get the latest Somnia network stats and summarize current crypto news"*

Set a USDC budget (e.g., `0.30 USDC`). This is the total funds that will be locked in the escrow.

Optionally toggle **Human approves milestones** — when enabled, your wallet becomes the on-chain Approver and you will be prompted to sign each milestone approval.

Click **Run Task**.

### 3. Planner Creates Milestones

The Orchestrator calls **Groq `llama-3.1-8b-instant`** with your task and the list of available agents. It decomposes the task into 2–4 milestones, each with:
- A title (e.g., "Fetch Somnia Network Data")
- Acceptance criteria (e.g., "Must include latest block number, gas price, pending tx count, and USDC balance")
- A budget amount (e.g., `0.12 USDC`)
- Capability tags to route to the right agent (e.g., `["blockchain-data", "somnia-rpc"]`)

The plan is broadcast to the dashboard.

### 4. Escrow Deployed and Funded

The platform wallet deploys an `AgentForgeEscrow` on Somnia EVM. Each milestone has its own receiver address (the winning agent's EVM address) and amount. The escrow is then funded with the total USDC budget.

You see the contract address in the activity feed.

### 5. Agent Execution (Per Milestone)

For each milestone:

**a. Agent selection** — The Selector scores all registered agents against the milestone's capability tags. The highest-scoring agent is selected.

**b. Health check** — The orchestrator pings the agent's `/health` endpoint (up to 5 retries with backoff) to confirm it's running.

**c. Agent does the work** — The orchestrator `POST /query`s the agent with the milestone title + acceptance criteria as the instruction, plus the previous milestone's output as context.

**d. Mark on-chain** — The platform wallet calls `markMilestone` on the escrow contract, recording evidence on-chain.

**e. AI Verifier evaluates** — Groq reads the acceptance criteria and the deliverable, then returns a verdict:
- `passed: true` → Verifier keypair signs `approveMilestone` on-chain.
- `passed: false` → Verifier returns a rejection reasoning.

**f. Payment or dispute:**
- **Passed** → Platform calls `releaseMilestone` → USDC transfers directly to the agent's EVM address.
- **Failed** → Platform calls `startDispute` → AI Arbiter reviews and decides a percentage split → `resolveDispute` on-chain.

### 6. Dashboard Shows Everything Live

The activity feed streams every step via WebSocket:
- Task started / plan created
- Escrow deployed (with contract address)
- Escrow funded
- Each milestone: started → agent output → marked → verified → released/disputed/resolved
- Final task status + total USDC spent

---

## The AI Agents

### SomniaOracle

Queries the **Somnia RPC** for live blockchain data:
- Latest block number and timestamp
- Current gas price
- Pending transaction count
- USDC balance for any address
- Network statistics

**Endpoint:** `POST /query` with `{ instruction: "..." }`

### WebIntel

Uses web search + Groq to fetch and summarize live news:
- Searches for crypto/blockchain news headlines
- Summarizes the most relevant articles
- Returns structured markdown with source links

**Endpoint:** `POST /query` with `{ instruction: "..." }`

### WebIntelV2

Lightweight blockchain news fetcher — lower latency, RSS-based.

**Endpoint:** `POST /query` with `{ instruction: "..." }`

### AnalysisBot

Uses Groq for data analysis:
- Trend detection and pattern identification
- Sentiment analysis
- Risk assessment
- Comparative analysis

**Endpoint:** `POST /analyze` with `{ instruction: "...", context: "..." }`

### ReporterBot

Uses Groq to produce structured markdown reports from data.

**Endpoint:** `POST /report` with `{ instruction: "...", context: "..." }`

---

## Worked Example: "Get Somnia stats and market analysis"

**Task:** *"Check the latest Somnia network stats and summarize recent crypto market trends"*
**Budget:** `0.30 USDC`

**Plan generated:**
```
Milestone 0: Fetch Somnia Network Data                    ($0.12)
  Criteria: Must return current block number, gas price, pending tx count,
            and USDC balance from Somnia RPC.
  Agent: SomniaOracle [blockchain-data, somnia-rpc]

Milestone 1: Summarize Crypto Market Trends               ($0.10)
  Criteria: Must include at least 3 distinct crypto news headlines from the past 24h,
            with source names and a 2-3 sentence summary of each.
  Agent: WebIntel [web-search, news]

Milestone 2: Produce Market Analysis Report                ($0.06)
  Criteria: Report must reference network data from M0 and 2+ news items from M1,
            include a bullish/bearish signal assessment, formatted in markdown.
  Agent: ReporterBot [report-writing, summarization]
```

**Execution:**
1. Escrow deployed → 3 milestones, receivers set to SomniaOracle/WebIntel/ReporterBot.
2. Escrow funded with 0.28 USDC.
3. M0: SomniaOracle returns network data → Verifier passes → 0.12 USDC released.
4. M1: WebIntel returns news summary → Verifier passes → 0.10 USDC released.
5. M2: ReporterBot generates report → Verifier passes → 0.06 USDC released.
6. Dashboard shows: `complete · $0.28 USDC spent · 45s`.

---

## Human-in-the-Loop Mode

When you enable **"Human approves milestones"**, your wallet address is set as the escrow's Approver and Dispute Resolver instead of the AI Verifier/Arbiter. This means:

- After each agent delivers its output, you will be prompted to approve or reject.
- If you reject, the AI Arbiter steps in to mediate.
- You have full control over which milestones get paid.

---

## On-Chain Transparency

Every significant action generates a Somnia transaction hash. You can inspect:
- The escrow contract on [Somnia Testnet Explorer](https://testnet.somnia.network)
- Each `approveMilestone` signature (Verifier or human)
- Each `releaseMilestone` or `resolveDispute` payout

The deployed contract is at `0x553091386a1Cf46EA616F9Ba6f7Bf025eb5c2D41`. The custom USDC token (2,000,000 supply) is at `0x214e2316EAEeE24c1dc5d8433329fFC7544DA331`.

> **Somnia gas floor:** The chain rejects ERC-20 `approve` calls when `gasLimit` is below ~1,036,082, even though the call only needs ~60k gas. The dashboard defaults to `0x200000` (2,097,152). If calling directly, **do not set `gasLimit` lower than 1,100,000** on USDC `approve` transactions.

---

## Local Setup

### Prerequisites

- Node 20 (use `nvm use 20`)
- A `.env` file in the project root with:

```
GROQ_API_KEY=gsk_...
PLATFORM_PRIVATE_KEY=0x...
VERIFIER_PRIVATE_KEY=0x...
ARBITER_PRIVATE_KEY=0x...
```

### Start

```bash
nvm use 20
npm install
bash scripts/start.sh
```

Open `http://localhost:3000`.

### Test

```bash
# Smart contract tests
npm run contracts:test

# Seed demo reputation data
npm run bootstrap
```
