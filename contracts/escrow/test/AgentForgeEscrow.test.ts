import { expect } from 'chai';
import { ethers } from 'hardhat';
import { type AgentForgeEscrow, type TestToken } from '../typechain-types';
import { type HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// Reusable fixture: deploys USDC + Escrow, mints + approves USDC, deploys escrow
async function deployFixture() {
  const accounts = await ethers.getSigners();
  const [owner, platform, serviceProvider, approver, disputeResolver, releaseSigner, funder, agent] = accounts;

  const TestTokenFactory = await ethers.getContractFactory('TestToken');
  const usdc = await TestTokenFactory.deploy('USD Coin', 'USDC', 6) as unknown as TestToken;
  await usdc.waitForDeployment();

  const EscrowFactory = await ethers.getContractFactory('AgentForgeEscrow');
  const escrow = await EscrowFactory.deploy(await usdc.getAddress()) as unknown as AgentForgeEscrow;
  await escrow.waitForDeployment();

  // mint 10000 USDC to funder
  await usdc.mint(await funder.getAddress(), 10_000_000_000n);
  // mint 1000 USDC to platform (for gas/refunds)
  await usdc.mint(await platform.getAddress(), 1_000_000_000n);

  // approve escrow to spend funder's USDC
  await usdc.connect(funder).approve(await escrow.getAddress(), 10_000_000_000n);

  const USDC_DECIMALS = 6n;
  const milestoneAmount1 = 100n * 10n ** USDC_DECIMALS;
  const milestoneAmount2 = 200n * 10n ** USDC_DECIMALS;

  const milestones = [
    {
      description: 'Research phase',
      amount: milestoneAmount1,
      receiver: await agent.getAddress(),
      status: 0n,
      evidence: '',
      agentAddress: ethers.ZeroAddress,
    },
    {
      description: 'Implementation phase',
      amount: milestoneAmount2,
      receiver: await agent.getAddress(),
      status: 0n,
      evidence: '',
      agentAddress: ethers.ZeroAddress,
    },
  ];

  const escrowId = 'task-001';

  await escrow.connect(platform).deployEscrow(
    escrowId,
    'Build a dashboard',
    'Build and deploy a dashboard',
    await platform.getAddress(),
    await serviceProvider.getAddress(),
    await approver.getAddress(),
    await disputeResolver.getAddress(),
    await releaseSigner.getAddress(),
    milestones,
  );

  return {
    escrow,
    usdc,
    escrowId,
    owner, platform, serviceProvider, approver, disputeResolver, releaseSigner, funder, agent,
    accounts: { owner, platform, serviceProvider, approver, disputeResolver, releaseSigner, funder, agent },
    milestoneAmount1,
    milestoneAmount2,
    milestones,
  };
}

describe('AgentForgeEscrow', function () {
  describe('Deployment', function () {
    it('should deploy with USDC address set', async function () {
      const { escrow, usdc } = await deployFixture();
      expect(await escrow.usdc()).to.equal(await usdc.getAddress());
    });

    it('should reject duplicate escrow ID', async function () {
      const { escrow, escrowId, platform, serviceProvider, approver, disputeResolver, releaseSigner, milestones } =
        await deployFixture();

      await expect(
        escrow.connect(platform).deployEscrow(
          escrowId,
          'Duplicate',
          'dup',
          await platform.getAddress(),
          await serviceProvider.getAddress(),
          await approver.getAddress(),
          await disputeResolver.getAddress(),
          await releaseSigner.getAddress(),
          milestones,
        ),
      ).to.be.revertedWith('Escrow already exists');
    });

    it('should reject zero milestones', async function () {
      const { escrow, platform, serviceProvider, approver, disputeResolver, releaseSigner } =
        await deployFixture();

      await expect(
        escrow.connect(platform).deployEscrow(
          'task-empty',
          'Empty',
          '',
          await platform.getAddress(),
          await serviceProvider.getAddress(),
          await approver.getAddress(),
          await disputeResolver.getAddress(),
          await releaseSigner.getAddress(),
          [],
        ),
      ).to.be.revertedWith('At least one milestone');
    });
  });

  describe('Funding', function () {
    it('should fund an escrow', async function () {
      const { escrow, usdc, escrowId, funder, milestoneAmount1, milestoneAmount2 } = await deployFixture();
      const total = milestoneAmount1 + milestoneAmount2;

      await expect(escrow.connect(funder).fundEscrow(escrowId, total))
        .to.emit(escrow, 'EscrowFunded')
        .withArgs(escrowId, await funder.getAddress(), total);

      const contractBalance = await usdc.balanceOf(await escrow.getAddress());
      expect(contractBalance).to.equal(total);

      const info = await escrow.getEscrow(escrowId);
      expect(info.totalFunded).to.equal(total);
      expect(info.status).to.equal(1n); // Funded
    });

    it('should reject funding non-existent escrow', async function () {
      const { escrow, funder } = await deployFixture();
      await expect(escrow.connect(funder).fundEscrow('no-such-id', 1000n))
        .to.be.revertedWith('Escrow not found');
    });

    it('should reject double funding', async function () {
      const { escrow, escrowId, funder, milestoneAmount1, milestoneAmount2 } = await deployFixture();
      const total = milestoneAmount1 + milestoneAmount2;
      await escrow.connect(funder).fundEscrow(escrowId, total);
      await expect(escrow.connect(funder).fundEscrow(escrowId, total))
        .to.be.revertedWith('Not active');
    });
  });

  describe('Milestone lifecycle', function () {
    it('should complete full happy path: mark → approve → release', async function () {
      const { escrow, escrowId, serviceProvider, approver, releaseSigner, funder, agent, usdc, milestoneAmount1, milestoneAmount2 } =
        await deployFixture();
      const total = milestoneAmount1 + milestoneAmount2;

      // fund
      await escrow.connect(funder).fundEscrow(escrowId, total);
      const escrowAddr = await escrow.getAddress();

      // mark milestone 0 as completed
      await expect(escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'ipfs://research-evidence'))
        .to.emit(escrow, 'MilestoneMarked')
        .withArgs(escrowId, 0n, 'ipfs://research-evidence');

      const ms0 = await escrow.getMilestone(escrowId, 0);
      expect(ms0.status).to.equal(1n); // Completed

      // approve milestone 0
      await expect(escrow.connect(approver).approveMilestone(escrowId, 0))
        .to.emit(escrow, 'MilestoneApproved')
        .withArgs(escrowId, 0n, await approver.getAddress());

      const ms0a = await escrow.getMilestone(escrowId, 0);
      expect(ms0a.status).to.equal(2n); // Approved

      // release milestone 0
      const agentBalBefore = await usdc.balanceOf(await agent.getAddress());
      await expect(escrow.connect(releaseSigner).releaseMilestone(escrowId, 0))
        .to.emit(escrow, 'MilestoneReleased')
        .withArgs(escrowId, 0n, await agent.getAddress(), milestoneAmount1);

      const agentBalAfter = await usdc.balanceOf(await agent.getAddress());
      expect(agentBalAfter - agentBalBefore).to.equal(milestoneAmount1);

      const ms0r = await escrow.getMilestone(escrowId, 0);
      expect(ms0r.status).to.equal(3n); // Released

      // verify escrow balance tracking
      const info = await escrow.getEscrow(escrowId);
      expect(info.totalReleased).to.equal(milestoneAmount1);
      expect(await escrow.getTotalBalance(escrowId)).to.equal(total - milestoneAmount1);

      // mark + approve + release milestone 1
      await escrow.connect(serviceProvider).markMilestone(escrowId, 1, 'ipfs://impl-evidence');
      await escrow.connect(approver).approveMilestone(escrowId, 1);
      await escrow.connect(releaseSigner).releaseMilestone(escrowId, 1);

      const agentFinalBal = await usdc.balanceOf(await agent.getAddress());
      expect(agentFinalBal - agentBalBefore).to.equal(total);

      const info2 = await escrow.getEscrow(escrowId);
      expect(info2.totalReleased).to.equal(total);
      expect(await escrow.getTotalBalance(escrowId)).to.equal(0n);
    });

    it('should emit MilestoneApproved event with correct args', async function () {
      const { escrow, escrowId, serviceProvider, approver, funder, milestoneAmount1, milestoneAmount2 } =
        await deployFixture();

      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');

      await expect(escrow.connect(approver).approveMilestone(escrowId, 0))
        .to.emit(escrow, 'MilestoneApproved')
        .withArgs(escrowId, 0n, await approver.getAddress());
    });
  });

  describe('Access control', function () {
    it('should reject markMilestone from non-service-provider', async function () {
      const { escrow, escrowId, funder, milestoneAmount1, milestoneAmount2, accounts } = await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);

      await expect(escrow.connect(accounts.owner).markMilestone(escrowId, 0, 'evidence'))
        .to.be.revertedWith('Only service provider');
    });

    it('should reject approveMilestone from non-approver', async function () {
      const { escrow, escrowId, serviceProvider, funder, milestoneAmount1, milestoneAmount2, accounts } =
        await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');

      await expect(escrow.connect(accounts.owner).approveMilestone(escrowId, 0))
        .to.be.revertedWith('Only approver');
    });

    it('should reject releaseMilestone from non-release-signer', async function () {
      const { escrow, escrowId, serviceProvider, approver, funder, milestoneAmount1, milestoneAmount2, accounts } =
        await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(approver).approveMilestone(escrowId, 0);

      await expect(escrow.connect(accounts.owner).releaseMilestone(escrowId, 0))
        .to.be.revertedWith('Only release signer');
    });

    it('should reject startDispute from non-service-provider', async function () {
      const { escrow, escrowId, funder, milestoneAmount1, milestoneAmount2, accounts } = await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);

      await expect(escrow.connect(accounts.owner).startDispute(escrowId, 0))
        .to.be.revertedWith('Only service provider');
    });

    it('should reject resolveDispute from non-dispute-resolver', async function () {
      const { escrow, escrowId, serviceProvider, funder, milestoneAmount1, milestoneAmount2, accounts } =
        await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(serviceProvider).startDispute(escrowId, 0);

      await expect(
        escrow.connect(accounts.owner).resolveDispute(escrowId, 0, [await accounts.owner.getAddress()], [100n]),
      ).to.be.revertedWith('Only dispute resolver');
    });
  });

  describe('State machine', function () {
    it('should reject markMilestone on already-completed milestone', async function () {
      const { escrow, escrowId, serviceProvider, approver, releaseSigner, funder, milestoneAmount1, milestoneAmount2 } =
        await deployFixture();

      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(approver).approveMilestone(escrowId, 0);
      await escrow.connect(releaseSigner).releaseMilestone(escrowId, 0);

      await expect(escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'again'))
        .to.be.revertedWith('Already completed');
    });

    it('should reject approveMilestone on pending milestone', async function () {
      const { escrow, escrowId, approver, funder, milestoneAmount1, milestoneAmount2 } = await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);

      await expect(escrow.connect(approver).approveMilestone(escrowId, 0))
        .to.be.revertedWith('Not completed');
    });

    it('should reject releaseMilestone on non-approved milestone', async function () {
      const { escrow, escrowId, serviceProvider, releaseSigner, funder, milestoneAmount1, milestoneAmount2 } =
        await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');

      await expect(escrow.connect(releaseSigner).releaseMilestone(escrowId, 0))
        .to.be.revertedWith('Not approved');
    });

    it('should reject invalid milestone index', async function () {
      const { escrow, escrowId, serviceProvider, funder, milestoneAmount1, milestoneAmount2 } = await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);

      await expect(escrow.connect(serviceProvider).markMilestone(escrowId, 99, 'evidence'))
        .to.be.revertedWith('Invalid index');
    });
  });

  describe('Dispute lifecycle', function () {
    it('should complete full dispute flow: dispute → resolve with split', async function () {
      const { escrow, escrowId, serviceProvider, disputeResolver, funder, agent, milestoneAmount1, milestoneAmount2, usdc } =
        await deployFixture();
      const total = milestoneAmount1 + milestoneAmount2;
      const escrowAddr = await escrow.getAddress();

      // fund
      await escrow.connect(funder).fundEscrow(escrowId, total);

      // mark + approve milestone 0
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(serviceProvider).startDispute(escrowId, 0);

      const ms0 = await escrow.getMilestone(escrowId, 0);
      expect(ms0.status).to.equal(4n); // Disputed

      // resolve: 60% to agent, 40% back to funder
      const agentShare = (milestoneAmount1 * 60n) / 100n;
      const funderShare = milestoneAmount1 - agentShare;

      await expect(
        escrow.connect(disputeResolver).resolveDispute(
          escrowId,
          0,
          [await agent.getAddress(), await funder.getAddress()],
          [agentShare, funderShare],
        ),
      )
        .to.emit(escrow, 'DisputeResolved')
        .withArgs(escrowId, 0n, await agent.getAddress(), agentShare);

      const ms0r = await escrow.getMilestone(escrowId, 0);
      expect(ms0r.status).to.equal(5n); // Resolved

      const agentBal = await usdc.balanceOf(await agent.getAddress());
      expect(agentBal).to.equal(agentShare);

      const info = await escrow.getEscrow(escrowId);
      expect(info.totalReleased).to.equal(milestoneAmount1);
    });

    it('should reject resolving a non-disputed milestone', async function () {
      const { escrow, escrowId, disputeResolver } = await deployFixture();

      await expect(
        escrow.connect(disputeResolver).resolveDispute(escrowId, 0, [await disputeResolver.getAddress()], [100n]),
      ).to.be.revertedWith('Not disputed');
    });

    it('should reject dispute with invalid distribution arrays', async function () {
      const { escrow, escrowId, serviceProvider, disputeResolver, funder, milestoneAmount1, milestoneAmount2, agent } =
        await deployFixture();
      await escrow.connect(funder).fundEscrow(escrowId, milestoneAmount1 + milestoneAmount2);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(serviceProvider).startDispute(escrowId, 0);

      await expect(
        escrow.connect(disputeResolver).resolveDispute(
          escrowId,
          0,
          [await agent.getAddress()],
          [100n, 200n], // mismatched arrays
        ),
      ).to.be.revertedWith('Invalid distribution');
    });
  });

  describe('View functions', function () {
    it('should return correct milestone count', async function () {
      const { escrow, escrowId } = await deployFixture();
      expect(await escrow.getMilestoneCount(escrowId)).to.equal(2n);
    });

    it('should return total balance after partial release', async function () {
      const { escrow, escrowId, serviceProvider, approver, releaseSigner, funder, milestoneAmount1, milestoneAmount2 } =
        await deployFixture();
      const total = milestoneAmount1 + milestoneAmount2;

      await escrow.connect(funder).fundEscrow(escrowId, total);
      await escrow.connect(serviceProvider).markMilestone(escrowId, 0, 'evidence');
      await escrow.connect(approver).approveMilestone(escrowId, 0);
      await escrow.connect(releaseSigner).releaseMilestone(escrowId, 0);

      expect(await escrow.getTotalBalance(escrowId)).to.equal(milestoneAmount2);
    });

    it('should return zero balance for non-existent escrow', async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.getTotalBalance('no-such')).to.equal(0n);
    });
  });
});
