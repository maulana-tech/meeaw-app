// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MaweeRegistry
/// @notice Maps `@username` to its owner plus the two public keys a payer needs:
/// the Poseidon note public key (who can spend the note) and the x25519 viewing
/// public key (who can decrypt the note metadata).
contract MaweeRegistry {
    uint256 public constant MIN_LEN = 3;
    uint256 public constant MAX_LEN = 32;

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

    /// @notice Claim `username` for `msg.sender`. One username per address.
    function register(string calldata username, bytes32 notePubkey, bytes32 viewPubkey) external {
        _validate(username);
        bytes32 key = keccak256(bytes(username));
        if (accounts[key].owner != address(0)) revert UsernameTaken();
        if (bytes(usernames[msg.sender]).length != 0) revert OwnerHasUsername();

        accounts[key] = Account({
            owner: msg.sender,
            notePubkey: notePubkey,
            viewPubkey: viewPubkey,
            created: uint64(block.timestamp)
        });
        usernames[msg.sender] = username;
        emit Registered(key, username, msg.sender, notePubkey, viewPubkey);
    }

    /// @notice Rotate both keys together. Rotating only one would make future
    /// note discovery fail, because payers encrypt to the view key and bind the
    /// note to the note key in the same payment.
    function setPubkeys(string calldata username, bytes32 notePubkey, bytes32 viewPubkey) external {
        bytes32 key = keccak256(bytes(username));
        Account storage account = accounts[key];
        // Same error for "missing" and "not yours" so callers can fall back to
        // register() without learning who owns a name.
        if (account.owner != msg.sender) revert UsernameNotFound();
        account.notePubkey = notePubkey;
        account.viewPubkey = viewPubkey;
        emit PubkeysRotated(key, msg.sender, notePubkey, viewPubkey);
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
