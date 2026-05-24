import { ethers } from 'hardhat';

const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS;
const EXPECTED_CHAIN_ID = 50312;

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Network:  ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${(await ethers.getSigners())[0].address}`);

  if (chainId === 5031) {
    console.log('⚠  Deploying to Somnia Mainnet — double-check USDC address!');
  } else if (chainId !== EXPECTED_CHAIN_ID) {
    console.warn(`⚠  Unexpected chain ID ${chainId}. Expected Somnia Testnet (${EXPECTED_CHAIN_ID}).`);
  }

  if (!USDC_ADDRESS) {
    throw new Error('USDC_CONTRACT_ADDRESS not set in .env');
  }
  console.log(`USDC:     ${USDC_ADDRESS}`);

  const EscrowFactory = await ethers.getContractFactory('AgentForgeEscrow');
  const escrow = await EscrowFactory.deploy(USDC_ADDRESS);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log(`\nAgentForgeEscrow deployed at: ${address}`);

  const verifyUsdc = await escrow.usdc();
  console.log(`USDC in contract:             ${verifyUsdc}`);
  console.assert(
    verifyUsdc.toLowerCase() === USDC_ADDRESS.toLowerCase(),
    'USDC address mismatch!',
  );

  console.log('\nAdd to your .env:');
  console.log(`ESCROW_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error('Deployment failed:', err.message);
  process.exitCode = 1;
});
