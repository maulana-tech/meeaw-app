// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IVerifier2 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[2] calldata publicSignals
    ) external view returns (bool);
}

interface IVerifier4 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata publicSignals
    ) external view returns (bool);
}

/// @title MaweePool
/// @notice Shielded ERC-20 pool. A payment stores only a Poseidon note
/// commitment in an incremental Merkle tree; the recipient later proves note
/// ownership with a Groth16 proof without revealing which deposit created it.
///
/// Public signal layouts (must match circuits/src/*.circom):
///   deposit  = [commitment, amount]
///   withdraw = [root, nullifier, recipient, amount]
///   transfer = [root, nullifier, outCommitmentRecipient, outCommitmentChange]
///
/// Every entry point can be submitted by a relayer, so users never need gas:
/// withdraw/transfer are authorized by their proofs, and deposits by the
/// payer's EIP-712 signature (plus an optional EIP-2612 permit).
contract MaweePool is EIP712, Nonces {
    /// Fixed by the circuits (`Withdraw(20)` / `Transfer(20)`).
    uint32 public constant TREE_DEPTH = 20;
    uint32 public constant ROOT_HISTORY_SIZE = 30;
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// Binds the payer's funds to one exact note, so whoever relays the
    /// signature cannot redirect the payment into a different commitment or
    /// replace the encrypted note the recipient needs to find it.
    bytes32 public constant DEPOSIT_TYPEHASH = keccak256(
        "Deposit(address payer,bytes32 commitment,uint256 amount,bytes32 ephemeralPk,bytes32 ciphertextHash,uint256 nonce,uint256 deadline)"
    );

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct NoteOutput {
        bytes32 commitment;
        bytes32 ephemeralPk;
        bytes ciphertext;
    }

    /// EIP-2612 permit for the pool asset. `deadline == 0` means "no permit,
    /// the payer already approved the pool".
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    error InvalidAmount();
    error InvalidFieldElement();
    error InvalidProof();
    error UnknownRoot();
    error DoubleSpend();
    error TreeFull();
    error Paused();
    error NotAdmin();
    error NotPendingAdmin();
    error TokenTransferFailed();
    error ZeroAddress();
    error SignatureExpired();
    error InvalidSignature();

    /// Encrypted note metadata for recipients to scan. Emitted for direct
    /// deposits and for both outputs of a shielded transfer.
    event Deposit(uint32 indexed leafIndex, bytes32 commitment, bytes32 ephemeralPk, bytes ciphertext);
    event Withdrawal(bytes32 indexed nullifier, address indexed recipient, uint256 amount);
    event Spend(bytes32 indexed nullifier);
    event PausedSet(bool paused);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);

    IERC20 public immutable token;
    IVerifier2 public immutable depositVerifier;
    IVerifier4 public immutable withdrawVerifier;
    IVerifier4 public immutable transferVerifier;

    address public admin;
    address public pendingAdmin;
    bool public paused;

    uint32 public nextIndex;
    uint32 public currentRootIndex;
    uint256[TREE_DEPTH + 1] private zeros;
    uint256[TREE_DEPTH] private filledSubtrees;
    uint256[ROOT_HISTORY_SIZE] private roots;
    mapping(bytes32 nullifier => bool) private spent;

    constructor(
        address admin_,
        IERC20 token_,
        IVerifier2 depositVerifier_,
        IVerifier4 withdrawVerifier_,
        IVerifier4 transferVerifier_
    ) EIP712("MaweePool", "1") {
        if (
            admin_ == address(0) || address(token_) == address(0) || address(depositVerifier_) == address(0)
                || address(withdrawVerifier_) == address(0) || address(transferVerifier_) == address(0)
        ) revert ZeroAddress();
        admin = admin_;
        token = token_;
        depositVerifier = depositVerifier_;
        withdrawVerifier = withdrawVerifier_;
        transferVerifier = transferVerifier_;

        uint256 z = 0;
        zeros[0] = z;
        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            filledSubtrees[i] = z;
            z = PoseidonT3.hash([z, z]);
            zeros[i + 1] = z;
        }
        roots[0] = z;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // --- payments ------------------------------------------------------------

    /// @notice Pay `amount` tokens from `msg.sender` into a private note.
    /// The deposit proof binds `commitment = Poseidon(amount, ownerPk, salt)` to
    /// the public `amount`, so a payer cannot mint a note worth more than paid.
    function deposit(
        bytes32 commitment,
        uint256 amount,
        Proof calldata proof,
        bytes32 ephemeralPk,
        bytes calldata ciphertext
    ) external whenNotPaused returns (uint32 leafIndex) {
        return _deposit(msg.sender, commitment, amount, proof, ephemeralPk, ciphertext);
    }

    /// @notice Gasless deposit: a relayer submits `payer`'s signed authorization
    /// (and optionally a permit) and the pool pulls the tokens from `payer`.
    function depositWithAuthorization(
        address payer,
        bytes32 commitment,
        uint256 amount,
        Proof calldata proof,
        bytes32 ephemeralPk,
        bytes calldata ciphertext,
        uint256 deadline,
        bytes calldata signature,
        PermitData calldata permit
    ) external whenNotPaused returns (uint32 leafIndex) {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _depositDigest(payer, commitment, amount, ephemeralPk, keccak256(ciphertext), deadline);
        if (!SignatureChecker.isValidSignatureNow(payer, digest, signature)) revert InvalidSignature();

        if (permit.deadline != 0) {
            // A front-runner may already have submitted this permit; then the
            // allowance exists and transferFrom below still succeeds.
            try IERC20Permit(address(token)).permit(
                payer, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {}
        }
        return _deposit(payer, commitment, amount, proof, ephemeralPk, ciphertext);
    }

    /// @notice Spend a note to `recipient`. Anyone may submit the proof (e.g. a
    /// relayer); `recipient` and `amount` are bound inside it.
    function withdraw(address recipient, uint256 amount, bytes32 root, bytes32 nullifier, Proof calldata proof)
        external
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > type(uint64).max) revert InvalidAmount();
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (spent[nullifier]) revert DoubleSpend();

        uint256[4] memory signals = [uint256(root), uint256(nullifier), recipientField(recipient), amount];
        if (!withdrawVerifier.verifyProof(proof.a, proof.b, proof.c, signals)) revert InvalidProof();

        spent[nullifier] = true;
        _safeTransfer(recipient, amount);
        emit Withdrawal(nullifier, recipient, amount);
        emit Spend(nullifier);
    }

    /// @notice Spend a note into two new notes (recipient + change) without
    /// tokens leaving the pool. Value conservation is enforced by the circuit.
    function transfer(
        bytes32 root,
        bytes32 nullifier,
        Proof calldata proof,
        NoteOutput calldata recipientNote,
        NoteOutput calldata changeNote
    ) external whenNotPaused returns (uint32 recipientIndex, uint32 changeIndex) {
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (spent[nullifier]) revert DoubleSpend();
        uint256 recipientLeaf = uint256(recipientNote.commitment);
        uint256 changeLeaf = uint256(changeNote.commitment);

        uint256[4] memory signals = [uint256(root), uint256(nullifier), recipientLeaf, changeLeaf];
        if (!transferVerifier.verifyProof(proof.a, proof.b, proof.c, signals)) revert InvalidProof();

        spent[nullifier] = true;
        recipientIndex = _insert(recipientLeaf);
        changeIndex = _insert(changeLeaf);
        emit Deposit(recipientIndex, recipientNote.commitment, recipientNote.ephemeralPk, recipientNote.ciphertext);
        emit Deposit(changeIndex, changeNote.commitment, changeNote.ephemeralPk, changeNote.ciphertext);
        emit Spend(nullifier);
    }

    // --- views ---------------------------------------------------------------

    /// The withdraw circuit's `recipient` signal is the destination address as
    /// a field element (160 bits always fits below FIELD_SIZE).
    function recipientField(address recipient) public pure returns (uint256) {
        return uint256(uint160(recipient));
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function currentRoot() external view returns (bytes32) {
        return bytes32(roots[currentRootIndex]);
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        uint256 r = uint256(root);
        if (r == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (roots[i] == r) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        } while (i != currentRootIndex);
        return false;
    }

    function isSpent(bytes32 nullifier) external view returns (bool) {
        return spent[nullifier];
    }

    function zeroAt(uint32 level) external view returns (bytes32) {
        return bytes32(zeros[level]);
    }

    // --- admin ---------------------------------------------------------------

    function setPaused(bool paused_) external onlyAdmin {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        emit AdminChanged(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }

    // --- internals -----------------------------------------------------------

    /// Consumes `payer`'s nonce, so each signed authorization works once.
    function _depositDigest(
        address payer,
        bytes32 commitment,
        uint256 amount,
        bytes32 ephemeralPk,
        bytes32 ciphertextHash,
        uint256 deadline
    ) private returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DEPOSIT_TYPEHASH, payer, commitment, amount, ephemeralPk, ciphertextHash, _useNonce(payer), deadline
                )
            )
        );
    }

    function _deposit(
        address from,
        bytes32 commitment,
        uint256 amount,
        Proof calldata proof,
        bytes32 ephemeralPk,
        bytes calldata ciphertext
    ) private returns (uint32 leafIndex) {
        if (amount == 0 || amount > type(uint64).max) revert InvalidAmount();
        uint256 leaf = uint256(commitment);
        if (leaf >= FIELD_SIZE) revert InvalidFieldElement();
        if (!depositVerifier.verifyProof(proof.a, proof.b, proof.c, [leaf, amount])) revert InvalidProof();

        _safeTransferFrom(from, address(this), amount);
        leafIndex = _insert(leaf);
        emit Deposit(leafIndex, commitment, ephemeralPk, ciphertext);
    }

    function _insert(uint256 leaf) private returns (uint32 index) {
        index = nextIndex;
        if (index >= uint32(1) << TREE_DEPTH) revert TreeFull();

        uint256 current = leaf;
        uint32 idx = index;
        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            uint256 left;
            uint256 right;
            if (idx & 1 == 0) {
                filledSubtrees[i] = current;
                left = current;
                right = zeros[i];
            } else {
                left = filledSubtrees[i];
                right = current;
            }
            current = PoseidonT3.hash([left, right]);
            idx >>= 1;
        }

        uint32 next = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = next;
        roots[next] = current;
        nextIndex = index + 1;
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }
}
