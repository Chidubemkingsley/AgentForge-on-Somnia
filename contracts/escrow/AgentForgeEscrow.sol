// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentForgeEscrow is Ownable, ReentrancyGuard {
    IERC20 public usdc;

    enum MilestoneStatus { Pending, Completed, Approved, Released, Disputed, Resolved }
    enum TaskStatus { Active, Funded, Complete, Failed }

    struct Milestone {
        string description;
        uint256 amount;       // USDC (6 decimals)
        address receiver;     // Agent EVM address
        MilestoneStatus status;
        string evidence;
        address agentAddress;
    }

    struct EscrowContract {
        string title;
        string description;
        address platform;
        address serviceProvider;
        address approver;
        address disputeResolver;
        address releaseSigner;
        TaskStatus status;
        uint256 totalFunded;
        uint256 totalReleased;
        Milestone[] milestones;
    }

    mapping(string => EscrowContract) public escrows;
    string[] public escrowIds;

    event EscrowDeployed(string indexed escrowId, string title, address platform);
    event EscrowFunded(string indexed escrowId, address funder, uint256 amount);
    event MilestoneMarked(string indexed escrowId, uint256 milestoneIndex, string evidence);
    event MilestoneApproved(string indexed escrowId, uint256 milestoneIndex, address approver);
    event MilestoneReleased(string indexed escrowId, uint256 milestoneIndex, address receiver, uint256 amount);
    event DisputeStarted(string indexed escrowId, uint256 milestoneIndex);
    event DisputeResolved(string indexed escrowId, uint256 milestoneIndex, address receiver, uint256 amount);

    modifier onlyApprover(string memory escrowId) {
        require(msg.sender == escrows[escrowId].approver, "Only approver");
        _;
    }

    modifier onlyReleaseSigner(string memory escrowId) {
        require(msg.sender == escrows[escrowId].releaseSigner, "Only release signer");
        _;
    }

    modifier onlyDisputeResolver(string memory escrowId) {
        require(msg.sender == escrows[escrowId].disputeResolver, "Only dispute resolver");
        _;
    }

    modifier onlyServiceProvider(string memory escrowId) {
        require(msg.sender == escrows[escrowId].serviceProvider, "Only service provider");
        _;
    }

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    function deployEscrow(
        string memory escrowId,
        string memory title,
        string memory description,
        address platform,
        address serviceProvider,
        address approver,
        address disputeResolver,
        address releaseSigner,
        Milestone[] memory initialMilestones
    ) external {
        require(escrows[escrowId].platform == address(0), "Escrow already exists");
        require(initialMilestones.length > 0, "At least one milestone");

        EscrowContract storage escrow = escrows[escrowId];
        escrow.title = title;
        escrow.description = description;
        escrow.platform = platform;
        escrow.serviceProvider = serviceProvider;
        escrow.approver = approver;
        escrow.disputeResolver = disputeResolver;
        escrow.releaseSigner = releaseSigner;
        escrow.status = TaskStatus.Active;

        for (uint256 i = 0; i < initialMilestones.length; i++) {
            escrow.milestones.push(Milestone({
                description: initialMilestones[i].description,
                amount: initialMilestones[i].amount,
                receiver: initialMilestones[i].receiver,
                status: MilestoneStatus.Pending,
                evidence: "",
                agentAddress: address(0)
            }));
        }

        escrowIds.push(escrowId);
        emit EscrowDeployed(escrowId, title, platform);
    }

    function fundEscrow(string memory escrowId, uint256 amount) external nonReentrant {
        EscrowContract storage escrow = escrows[escrowId];
        require(escrow.platform != address(0), "Escrow not found");
        require(escrow.status == TaskStatus.Active, "Not active");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        escrow.totalFunded += amount;
        escrow.status = TaskStatus.Funded;

        emit EscrowFunded(escrowId, msg.sender, amount);
    }

    function markMilestone(
        string memory escrowId,
        uint256 milestoneIndex,
        string memory evidence
    ) external onlyServiceProvider(escrowId) {
        EscrowContract storage escrow = escrows[escrowId];
        require(milestoneIndex < escrow.milestones.length, "Invalid index");
        Milestone storage ms = escrow.milestones[milestoneIndex];
        require(ms.status == MilestoneStatus.Pending, "Already completed");

        ms.status = MilestoneStatus.Completed;
        ms.evidence = evidence;

        emit MilestoneMarked(escrowId, milestoneIndex, evidence);
    }

    function approveMilestone(
        string memory escrowId,
        uint256 milestoneIndex
    ) external onlyApprover(escrowId) {
        EscrowContract storage escrow = escrows[escrowId];
        require(milestoneIndex < escrow.milestones.length, "Invalid index");
        Milestone storage ms = escrow.milestones[milestoneIndex];
        require(ms.status == MilestoneStatus.Completed, "Not completed");

        ms.status = MilestoneStatus.Approved;

        emit MilestoneApproved(escrowId, milestoneIndex, msg.sender);
    }

    function releaseMilestone(
        string memory escrowId,
        uint256 milestoneIndex
    ) external onlyReleaseSigner(escrowId) nonReentrant {
        EscrowContract storage escrow = escrows[escrowId];
        require(milestoneIndex < escrow.milestones.length, "Invalid index");
        Milestone storage ms = escrow.milestones[milestoneIndex];
        require(ms.status == MilestoneStatus.Approved, "Not approved");

        ms.status = MilestoneStatus.Released;
        escrow.totalReleased += ms.amount;

        require(usdc.transfer(ms.receiver, ms.amount), "Transfer failed");

        emit MilestoneReleased(escrowId, milestoneIndex, ms.receiver, ms.amount);
    }

    function startDispute(
        string memory escrowId,
        uint256 milestoneIndex
    ) external onlyServiceProvider(escrowId) {
        EscrowContract storage escrow = escrows[escrowId];
        require(milestoneIndex < escrow.milestones.length, "Invalid index");
        Milestone storage ms = escrow.milestones[milestoneIndex];
        require(ms.status == MilestoneStatus.Completed || ms.status == MilestoneStatus.Approved, "Cannot dispute");
        require(ms.status != MilestoneStatus.Resolved, "Already resolved");

        ms.status = MilestoneStatus.Disputed;

        emit DisputeStarted(escrowId, milestoneIndex);
    }

    function resolveDispute(
        string memory escrowId,
        uint256 milestoneIndex,
        address[] memory receivers,
        uint256[] memory amounts
    ) external onlyDisputeResolver(escrowId) nonReentrant {
        EscrowContract storage escrow = escrows[escrowId];
        require(milestoneIndex < escrow.milestones.length, "Invalid index");
        Milestone storage ms = escrow.milestones[milestoneIndex];
        require(ms.status == MilestoneStatus.Disputed, "Not disputed");
        require(receivers.length == amounts.length && receivers.length > 0, "Invalid distribution");

        ms.status = MilestoneStatus.Resolved;

        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < receivers.length; i++) {
            totalDistributed += amounts[i];
            require(usdc.transfer(receivers[i], amounts[i]), "Transfer failed");
            emit DisputeResolved(escrowId, milestoneIndex, receivers[i], amounts[i]);
        }

        escrow.totalReleased += totalDistributed;
    }

    function getEscrow(string memory escrowId) external view returns (EscrowContract memory) {
        return escrows[escrowId];
    }

    function getMilestone(string memory escrowId, uint256 milestoneIndex) external view returns (Milestone memory) {
        require(milestoneIndex < escrows[escrowId].milestones.length, "Invalid index");
        return escrows[escrowId].milestones[milestoneIndex];
    }

    function getMilestoneCount(string memory escrowId) external view returns (uint256) {
        return escrows[escrowId].milestones.length;
    }

    function getTotalBalance(string memory escrowId) external view returns (uint256) {
        EscrowContract storage escrow = escrows[escrowId];
        if (escrow.platform == address(0)) return 0;
        return escrow.totalFunded - escrow.totalReleased;
    }
}
