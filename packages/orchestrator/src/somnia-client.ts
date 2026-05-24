import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { walletFromPrivateKey } from '@agentforge/common';

const SOMNIA_RPC = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '';

const ESCROW_ABI = [
  'function deployEscrow(string memory escrowId, string memory title, string memory description, address platform, address serviceProvider, address approver, address disputeResolver, address releaseSigner, tuple(string description, uint256 amount, address receiver, uint8 status, string evidence, address agentAddress)[] memory initialMilestones) external',
  'function fundEscrow(string memory escrowId, uint256 amount) external',
  'function markMilestone(string memory escrowId, uint256 milestoneIndex, string memory evidence) external',
  'function approveMilestone(string memory escrowId, uint256 milestoneIndex) external',
  'function releaseMilestone(string memory escrowId, uint256 milestoneIndex) external',
  'function startDispute(string memory escrowId, uint256 milestoneIndex) external',
  'function resolveDispute(string memory escrowId, uint256 milestoneIndex, address[] memory receivers, uint256[] memory amounts) external',
  'function getEscrow(string memory escrowId) external view returns (tuple(string title, string description, address platform, address serviceProvider, address approver, address disputeResolver, address releaseSigner, uint8 status, uint256 totalFunded, uint256 totalReleased, tuple(string description, uint256 amount, address receiver, uint8 status, string evidence, address agentAddress)[] milestones))',
  'function getMilestone(string memory escrowId, uint256 milestoneIndex) external view returns (tuple(string description, uint256 amount, address receiver, uint8 status, string evidence, address agentAddress))',
  'function usdc() external view returns (address)',
];

export interface MilestonePayload {
  description: string;
  amount: number;
  receiver: string;
}

export interface DeployEscrowSpec {
  title: string;
  description: string;
  platformAddress: string;
  serviceProvider: string;
  approver: string;
  disputeResolver: string;
  releaseSigner: string;
  milestones: MilestonePayload[];
  humanOverride?: {
    approver?: string;
    disputeResolver?: string;
  };
}

export interface DeployResult {
  contractId: string;
  transactionHash: string;
}

export interface Distribution {
  address: string;
  amount: number;
}

let _provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(SOMNIA_RPC);
  }
  return _provider;
}

function getContract(signer?: ethers.Signer): ethers.Contract {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error('ESCROW_CONTRACT_ADDRESS not set');
  }
  const providerOrSigner = signer || getProvider();
  return new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, providerOrSigner);
}

export async function deployEscrow(
  spec: DeployEscrowSpec,
  platformWallet: ethers.Wallet,
): Promise<DeployResult> {
  const escrowId = uuidv4();
  const contract = getContract(platformWallet);

  const approver = spec.humanOverride?.approver ?? spec.approver;
  const disputeResolver = spec.humanOverride?.disputeResolver ?? spec.disputeResolver;

  const milestones = spec.milestones.map(m => ({
    description: m.description,
    amount: ethers.parseUnits(m.amount.toString(), 6),
    receiver: m.receiver,
    status: 0,
    evidence: '',
    agentAddress: ethers.ZeroAddress,
  }));

  const tx = await contract.deployEscrow(
    escrowId,
    spec.title,
    spec.description,
    spec.platformAddress,
    spec.serviceProvider,
    approver,
    disputeResolver,
    spec.releaseSigner,
    milestones,
  );

  const receipt = await tx.wait();
  const txHash = receipt?.hash || tx.hash;

  return { contractId: escrowId, transactionHash: txHash };
}

export async function fundEscrow(
  contractId: string,
  funderWallet: ethers.Wallet,
  amountUsdc: string,
): Promise<string> {
  const usdcAddress = await getContract().usdc();
  const usdcAbi = ['function approve(address spender, uint256 amount) external returns (bool)'];
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, funderWallet);

  const parsedAmount = ethers.parseUnits(amountUsdc, 6);

  const approveTx = await usdc.approve(ESCROW_CONTRACT_ADDRESS, parsedAmount);
  await approveTx.wait();

  const contract = getContract(funderWallet);
  const tx = await contract.fundEscrow(contractId, parsedAmount);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function markMilestone(
  contractId: string,
  milestoneIndex: number,
  evidence: string,
  serviceProviderWallet: ethers.Wallet,
): Promise<string> {
  const contract = getContract(serviceProviderWallet);
  const tx = await contract.markMilestone(contractId, milestoneIndex, evidence.slice(0, 500));
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function approveMilestone(
  contractId: string,
  milestoneIndex: number,
  approverWallet: ethers.Wallet,
): Promise<string> {
  const contract = getContract(approverWallet);
  const tx = await contract.approveMilestone(contractId, milestoneIndex);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function releaseMilestone(
  contractId: string,
  milestoneIndex: number,
  releaseSignerWallet: ethers.Wallet,
): Promise<string> {
  const contract = getContract(releaseSignerWallet);
  const tx = await contract.releaseMilestone(contractId, milestoneIndex);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function startDispute(
  contractId: string,
  milestoneIndex: number,
  serviceProviderWallet: ethers.Wallet,
): Promise<string> {
  const contract = getContract(serviceProviderWallet);
  const tx = await contract.startDispute(contractId, milestoneIndex);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function resolveDispute(
  contractId: string,
  milestoneIndex: number,
  distributions: Distribution[],
  arbiterWallet: ethers.Wallet,
): Promise<string> {
  const contract = getContract(arbiterWallet);
  const receivers = distributions.map(d => d.address);
  const amounts = distributions.map(d => ethers.parseUnits(d.amount.toString(), 6));

  const tx = await contract.resolveDispute(contractId, milestoneIndex, receivers, amounts);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function getEscrow(contractId: string): Promise<any> {
  const contract = getContract();
  const data = await contract.getEscrow(contractId);

  const milestones = data.milestones.map((m: any, i: number) => ({
    index: i,
    description: m.description,
    amount: ethers.formatUnits(m.amount, 6),
    receiver: m.receiver,
    status: ['Pending', 'Completed', 'Approved', 'Released', 'Disputed', 'Resolved'][m.status],
    evidence: m.evidence,
  }));

  return {
    contractId,
    title: data.title,
    description: data.description,
    platform: data.platform,
    approver: data.approver,
    disputeResolver: data.disputeResolver,
    status: ['Active', 'Funded', 'Complete', 'Failed'][data.status],
    totalFunded: ethers.formatUnits(data.totalFunded, 6),
    totalReleased: ethers.formatUnits(data.totalReleased, 6),
    milestones,
  };
}

export async function getFundEscrowTxData(
  contractId: string,
  funderAddress: string,
  amountUsdc: string,
): Promise<{ to: string; data: string; value: string }> {
  const usdcAddress = await getContract().usdc();
  const usdcAbi = ['function approve(address spender, uint256 amount) returns (bool)'];
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, getProvider());
  const parsedAmount = ethers.parseUnits(amountUsdc, 6);

  const approveData = usdc.interface.encodeFunctionData('approve', [ESCROW_CONTRACT_ADDRESS, parsedAmount]);

  const contract = getContract();
  const fundData = contract.interface.encodeFunctionData('fundEscrow', [contractId, parsedAmount]);

  return {
    to: usdcAddress,
    data: approveData,
    value: parsedAmount.toString(),
  };
}
