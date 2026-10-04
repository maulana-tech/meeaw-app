// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title MaweeRegistry
/// @notice Maps `@username` to its owner plus the two public keys a payer needs:
/// the Poseidon note public key (who can spend the note) and the x25519 viewing
/// public key (who can decrypt the note metadata).
///
/// Every write has a `…For` twin that takes the owner's EIP-712 signature, so a
/// relayer can submit it and the owner never needs gas.
contract MaweeRegistry is EIP712, Nonces {
    uint256 public constant MIN_LEN = 3;
    uint256 public constant MAX_LEN = 32;

    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Register(address owner,string username,bytes32 notePubkey,bytes32 viewPubkey,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant SET_PUBKEYS_TYPEHASH = keccak256(
        "SetPubkeys(address owner,string username,bytes32 notePubkey,bytes32 viewPubkey,uint256 nonce,uint256 deadline)"
    );

    struct Account {
        address owner;
        bytes32 notePubkey;
        bytes32 viewPubkey;
        uint64 created;
    }

    error UsernameTaken();
    error OwnerHasUsername();
    error UsernameNotFound();
    error UsernameTooShort();
    error UsernameTooLong();
    error UsernameInvalidCharacter();
    error SignatureExpired();
    error InvalidSignature();

    event Registered(
        bytes32 indexed usernameHash,
        string username,
        address indexed owner,
        bytes32 notePubkey,
        bytes32 viewPubkey
    );
    event PubkeysRotated(
        bytes32 indexed usernameHash,
        address indexed owner,
        bytes32 notePubkey,
        bytes32 viewPubkey
    );

    mapping(bytes32 usernameHash => Account) private accounts;
    mapping(address owner => string) private usernames;

    constructor() EIP712("MaweeRegistry", "1") {}

    /// @notice Claim `username` for `msg.sender`. One username per address.
    function register(string calldata username, bytes32 notePubkey, bytes32 viewPubkey) external {
        _register(msg.sender, username, notePubkey, viewPubkey);
    }

    /// @notice Gasless `register`: anyone may submit `owner`'s signature.
    function registerFor(
        address owner,
        string calldata username,
        bytes32 notePubkey,
        bytes32 viewPubkey,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _checkSignature(REGISTER_TYPEHASH, owner, username, notePubkey, viewPubkey, deadline, signature);
        _register(owner, username, notePubkey, viewPubkey);
    }

    /// @notice Rotate both keys together. Rotating only one would make future
    /// note discovery fail, because payers encrypt to the view key and bind the
    /// note to the note key in the same payment.
    function setPubkeys(string calldata username, bytes32 notePubkey, bytes32 viewPubkey) external {
        _setPubkeys(msg.sender, username, notePubkey, viewPubkey);
    }

    /// @notice Gasless `setPubkeys`: anyone may submit `owner`'s signature.
    function setPubkeysFor(
        address owner,
        string calldata username,
        bytes32 notePubkey,
        bytes32 viewPubkey,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _checkSignature(SET_PUBKEYS_TYPEHASH, owner, username, notePubkey, viewPubkey, deadline, signature);
        _setPubkeys(owner, username, notePubkey, viewPubkey);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function resolve(string calldata username) external view returns (Account memory account) {
        account = accounts[keccak256(bytes(username))];
        if (account.owner == address(0)) revert UsernameNotFound();
    }

    function ownerOf(string calldata username) external view returns (address owner) {
        owner = accounts[keccak256(bytes(username))].owner;
        if (owner == address(0)) revert UsernameNotFound();
    }

    /// @return The username owned by `owner`, or "" when it has none.
    function usernameOf(address owner) external view returns (string memory) {
        return usernames[owner];
    }

    function _register(address owner, string calldata username, bytes32 notePubkey, bytes32 viewPubkey) private {
        _validate(username);
        bytes32 key = keccak256(bytes(username));
        if (accounts[key].owner != address(0)) revert UsernameTaken();
        if (bytes(usernames[owner]).length != 0) revert OwnerHasUsername();

        accounts[key] =
            Account({owner: owner, notePubkey: notePubkey, viewPubkey: viewPubkey, created: uint64(block.timestamp)});
        usernames[owner] = username;
        emit Registered(key, username, owner, notePubkey, viewPubkey);
    }

    function _setPubkeys(address owner, string calldata username, bytes32 notePubkey, bytes32 viewPubkey) private {
        bytes32 key = keccak256(bytes(username));
        Account storage account = accounts[key];
        // Same error for "missing" and "not yours" so callers can fall back to
        // register() without learning who owns a name.
        if (account.owner != owner) revert UsernameNotFound();
        account.notePubkey = notePubkey;
        account.viewPubkey = viewPubkey;
        emit PubkeysRotated(key, owner, notePubkey, viewPubkey);
    }

    /// Verifies an EIP-712 signature by `owner` (EOA or ERC-1271 wallet) and
    /// consumes its nonce so the signature cannot be replayed.
    function _checkSignature(
        bytes32 typehash,
        address owner,
        string calldata username,
        bytes32 notePubkey,
        bytes32 viewPubkey,
        uint256 deadline,
        bytes calldata signature
    ) private {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    typehash,
                    owner,
                    keccak256(bytes(username)),
                    notePubkey,
                    viewPubkey,
                    _useNonce(owner),
                    deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();
    }

    function _validate(string calldata username) private pure {
        bytes calldata b = bytes(username);
        if (b.length < MIN_LEN) revert UsernameTooShort();
        if (b.length > MAX_LEN) revert UsernameTooLong();
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_";
            if (!ok) revert UsernameInvalidCharacter();
        }
    }
}
