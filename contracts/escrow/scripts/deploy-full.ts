import { ethers } from 'hardhat';

const EXPECTED_CHAIN_ID = 50312;
const USDC_TOTAL_SUPPLY = 2_000_000n * 10n ** 6n; // 2M USDC (6 decimals)

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const [deployer] = await ethers.getSigners();

  console.log(`Network:   ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer:  ${deployer.address}`);

  if (chainId !== EXPECTED_CHAIN_ID) {
    console.warn(`⚠  Unexpected chain ID ${chainId}. Expected Somnia Testnet (${EXPECTED_CHAIN_ID}).`);
  }

  // ── 1. Deploy USDC ──
  console.log('\n--- Deploying USDC ---');
  const usdcFactory = await ethers.getContractFactory('TestToken');
  const usdc = await usdcFactory.deploy('USD Coin', 'USDC', 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`USDC deployed at: ${usdcAddress}`);

  // Mint total supply to deployer
  const mintTx = await usdc.mint(deployer.address, USDC_TOTAL_SUPPLY);
  await mintTx.wait();
  console.log(`Minted ${USDC_TOTAL_SUPPLY} USDC (2,000,000) to ${deployer.address}`);

  const deployerBal = await usdc.balanceOf(deployer.address);
  console.log(`Deployer balance: ${ethers.formatUnits(deployerBal, 6)} USDC`);

  // ── 2. Deploy Escrow ──
  console.log('\n--- Deploying AgentForgeEscrow ---');
  const escrowFactory = await ethers.getContractFactory('AgentForgeEscrow');
  const escrow = await escrowFactory.deploy(usdcAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`AgentForgeEscrow deployed at: ${escrowAddress}`);

  const verifyUsdc = await escrow.usdc();
  console.log(`USDC in contract:              ${verifyUsdc}`);
  console.assert(
    verifyUsdc.toLowerCase() === usdcAddress.toLowerCase(),
    'USDC address mismatch!',
  );

  // ── 3. Print .env entries ──
  console.log('\n=====================');
  console.log('Add to your .env:');
  console.log('=====================');
  console.log(`USDC_CONTRACT_ADDRESS=${usdcAddress}`);
  console.log(`ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
}

main().catch((err) => {
  console.error('Deployment failed:', err.message);
  process.exitCode = 1;
});
