// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal interface of the Agent ID ERC-721 used for gating.
///         Only balanceOf is needed: > 0 means the address holds an Agent ID.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentJobBoard — on-chain micro-task board with escrow.
/// @notice Flow: poster posts a job and locks the reward (ERC20) in escrow ->
///         an Agent ID holder accepts -> worker submits a delivery
///         (off-chain link / content hash string) -> poster accepts and the
///         escrow pays the worker, or rejects and the worker resubmits.
///         If the review deadline passes without acceptance, anyone
///         (poster or worker) can trigger a refund back to the poster.
///
///         OWNER POWERS: this contract inherits Ownable, but there are NO
///         owner-only functions that move funds, pause the contract, change
///         the payment token, change the Agent ID contract, or alter any job.
///         The owner can ONLY transfer/renounce ownership (inherited from
///         OpenZeppelin Ownable). There is no withdraw function and no
///         backdoor: funds leave escrow ONLY via acceptDelivery (to the
///         worker), refund (to the poster) or cancelJob (to the poster,
///         only while the job is still Open / unaccepted).
///         See README.md "Owner 权限披露" for the plain-language version.
contract AgentJobBoard is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Production SPACE ID Agent ID contract on BSC mainnet (chainId 56).
    ///         Switch `agentId` to this address at mainnet launch.
    ///         On BSC testnet (chainId 97) there is no official SPACE ID
    ///         Agent ID deployment, so tests use a deployed MockAgentID.
    address public constant PRODUCTION_AGENT_ID =
        0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    IERC20 public immutable paymentToken;
    IAgentID public immutable agentId;

    enum Status {
        Open, // posted, reward locked, waiting for an Agent ID holder
        InProgress, // accepted, waiting for delivery
        Delivered, // delivery submitted, waiting for poster review
        Completed, // poster accepted, worker paid
        Refunded // deadline passed, reward returned to poster
    }

    struct Job {
        address poster;
        address worker;
        uint256 reward;
        uint256 reviewDeadline; // unix timestamp; acceptance must happen before this
        string title;
        string description;
        string delivery; // off-chain link / content hash, set by worker
        Status status;
    }

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;

    event JobPosted(
        uint256 indexed jobId,
        address indexed poster,
        uint256 reward,
        uint256 reviewDeadline
    );
    event JobAccepted(uint256 indexed jobId, address indexed worker);
    event DeliverySubmitted(
        uint256 indexed jobId,
        address indexed worker,
        string delivery
    );
    event DeliveryAccepted(uint256 indexed jobId, address indexed worker, uint256 reward);
    event DeliveryRejected(uint256 indexed jobId, address indexed poster);
    event JobRefunded(uint256 indexed jobId, address indexed poster, uint256 reward);
    event JobCancelled(uint256 indexed jobId, address indexed poster, uint256 reward);

    error NotPoster();
    error NotWorker();
    error NotAgentHolder();
    error InvalidStatus(Status current, Status expected);
    error DeadlineNotSet();
    error DeadlineNotPassed();
    error ZeroReward();
    error SelfAccept();

    constructor(address _paymentToken, address _agentId) Ownable(msg.sender) {
        require(_paymentToken != address(0), "payment token is zero address");
        require(_agentId != address(0), "agent id is zero address");
        paymentToken = IERC20(_paymentToken);
        agentId = IAgentID(_agentId);
    }

    /// @notice Post a job and lock `reward` of the payment token in escrow.
    /// @dev Caller must approve the board to spend `reward` first.
    /// @param reviewDeadline Unix timestamp by which the poster must accept
    ///        a delivery; after it, anyone may call refund().
    function postJob(
        string calldata title,
        string calldata description,
        uint256 reward,
        uint256 reviewDeadline
    ) external nonReentrant returns (uint256 jobId) {
        if (reward == 0) revert ZeroReward();
        if (reviewDeadline <= block.timestamp) revert DeadlineNotSet();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            poster: msg.sender,
            worker: address(0),
            reward: reward,
            reviewDeadline: reviewDeadline,
            title: title,
            description: description,
            delivery: "",
            status: Status.Open
        });

        paymentToken.safeTransferFrom(msg.sender, address(this), reward);
        emit JobPosted(jobId, msg.sender, reward, reviewDeadline);
    }

    /// @notice Accept an open job. Caller MUST hold an Agent ID.
    function acceptJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Open) revert InvalidStatus(job.status, Status.Open);
        if (msg.sender == job.poster) revert SelfAccept();
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentHolder();

        job.worker = msg.sender;
        job.status = Status.InProgress;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Submit a delivery (off-chain link / content hash string).
    function submitDelivery(uint256 jobId, string calldata delivery) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.InProgress)
            revert InvalidStatus(job.status, Status.InProgress);
        if (msg.sender != job.worker) revert NotWorker();

        job.delivery = delivery;
        job.status = Status.Delivered;
        emit DeliverySubmitted(jobId, msg.sender, delivery);
    }

    /// @notice Poster accepts the delivery: escrow pays the worker.
    function acceptDelivery(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Delivered)
            revert InvalidStatus(job.status, Status.Delivered);
        if (msg.sender != job.poster) revert NotPoster();

        job.status = Status.Completed;
        paymentToken.safeTransfer(job.worker, job.reward);
        emit DeliveryAccepted(jobId, job.worker, job.reward);
    }

    /// @notice Poster rejects the delivery. CHOICE (documented): the job
    ///         returns to InProgress and the same worker may resubmit a new
    ///         delivery; it does NOT fall back to Open (the worker keeps the
    ///         job, so a rejected worker cannot be silently replaced and the
    ///         poster cannot grief the worker by re-opening the job).
    ///         The delivery string is cleared so a stale delivery cannot be
    ///         re-accepted.
    function rejectDelivery(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Delivered)
            revert InvalidStatus(job.status, Status.Delivered);
        if (msg.sender != job.poster) revert NotPoster();

        job.delivery = "";
        job.status = Status.InProgress;
        emit DeliveryRejected(jobId, msg.sender);
    }

    /// @notice After `reviewDeadline`, anyone (poster or worker) may refund
    ///         the locked reward back to the poster. Callable while the job
    ///         is Open, InProgress or Delivered — i.e. whenever acceptance
    ///         has not happened in time. Completed jobs can never be refunded.
    function refund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (
            job.status != Status.Open &&
            job.status != Status.InProgress &&
            job.status != Status.Delivered
        ) revert InvalidStatus(job.status, Status.Open);
        if (block.timestamp <= job.reviewDeadline) revert DeadlineNotPassed();

        job.status = Status.Refunded;
        paymentToken.safeTransfer(job.poster, job.reward);
        emit JobRefunded(jobId, job.poster, job.reward);
    }

    /// @notice Poster cancels an unaccepted (Open) job and reclaims the reward.
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Open) revert InvalidStatus(job.status, Status.Open);
        if (msg.sender != job.poster) revert NotPoster();

        job.status = Status.Refunded;
        paymentToken.safeTransfer(job.poster, job.reward);
        emit JobCancelled(jobId, job.poster, job.reward);
    }

    /// @notice Read a full job record.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
