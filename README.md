# Audius Ethereum smart contracts

Audius has two sets of contracts - the one in this directory, which runs on Ethereum mainnet in
production, and the one
[here](https://github.com/AudiusProject/audius-protocol/tree/main/contracts) which runs on POA
mainnet in production.

The smart contracts in this directory implement the Audius ERC-20 token, staking functionality, service
provider registration, delegator support and off-chain service version management. For a
more in depth look at the contracts and architecture, please see the
[Audius Ethereum Contracts Wiki](https://github.com/AudiusProject/audius-protocol/wiki/Ethereum-Contracts-Overview)
page.

The two sets of smart contracts do not interact with one another, but both sets are used by end-user
clients and the off-chain services that run Audius to make use of their respective
functionality.

## Installation

To install and run the contracts locally, clone the `audius-protocol` repo and go into the
`eth-contracts` folder. Assuming you have node.js, npm, and docker installed, run the
following commands to run Ganache and migrate the contracts.

*Note* - Ganache from the command below is exposed on port 8546, not 8545.

```
npm install
npm run ganache
npm run truffle-migrate
```

## Test

To run tests, run the following command:

```
npm run test
```

To run tests with coverage calculation, run the following command:

```
npm run test-coverage
```

# Syncing Changes

## Setup
Add the audius-protocol repo as a remote in your extracted repos:
```bash
git remote add audius-protocol ../audius-protocol
git fetch audius-protocol
```

## Syncing with `audius-protocol`

1. **Find eth-contracts-related commits in the audius-protocol repo:**
```bash
git log audius-protocol/main --oneline -- "eth-contracts/*"
```

2. **Cherry-pick specific commits:**
```bash
git cherry-pick <commit-hash>
```

3. **Test your changes:**
```bash
# Adjust based on your actual build/test commands
npm run build
npm run test
```

4. **Handle conflicts if they occur:**
```bash
# Fix conflicts manually, then:
git add .
git cherry-pick --continue
```

## Security

Please report security issues to `security@audius.co` with a description of the
vulenerability and any steps to reproduce. We have bounties available for issues reported
via responsible disclosure!

## License

Apache 2.0
