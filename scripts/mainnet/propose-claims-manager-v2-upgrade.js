const {
  ADDRESSES,
  REGISTRY_KEYS,
  SIGNERS,
  artifact,
  assertAddress,
  assertCode,
  assertCondition,
  assertRegistryEntry,
  connect,
  contract,
  preflightGovernance,
  run,
  submitProposal
} = require('./lib')

const implementationArgument = () =>
  process.env.NEW_CLAIMS_MANAGER_IMPLEMENTATION ||
  process.argv.slice(2).find((argument) => !argument.startsWith('--'))

const main = async () => {
  const { execute, signer, web3 } = await connect(SIGNERS.proposer)
  const implementation = implementationArgument()
  assertCondition(
    implementation && web3.utils.isAddress(implementation),
    'Pass the new implementation address or set NEW_CLAIMS_MANAGER_IMPLEMENTATION.'
  )

  const { governance } = await preflightGovernance(web3)
  await assertRegistryEntry(
    web3,
    REGISTRY_KEYS.claimsManagerProxy,
    ADDRESSES.claimsManagerProxy,
    'ClaimsManagerProxy'
  )
  const newCode = await assertCode(
    web3,
    implementation,
    'New ClaimsManagerV2 implementation'
  )
  const expectedRuntime = artifact('ClaimsManagerV2').deployedBytecode
  assertCondition(
    web3.utils.keccak256(newCode) === web3.utils.keccak256(expectedRuntime),
    'New implementation bytecode does not match the local ClaimsManagerV2 artifact.'
  )

  const proxy = contract(
    web3,
    'AudiusAdminUpgradeabilityProxy',
    ADDRESSES.claimsManagerProxy
  )
  const [currentImplementation, proxyAdmin] = await Promise.all([
    proxy.methods.implementation().call(),
    proxy.methods.getAudiusProxyAdminAddress().call()
  ])
  assertAddress(
    currentImplementation,
    ADDRESSES.currentClaimsManagerImplementation,
    'Current ClaimsManager implementation'
  )
  assertAddress(proxyAdmin, ADDRESSES.governance, 'ClaimsManager proxy admin')
  assertCondition(
    currentImplementation.toLowerCase() !== implementation.toLowerCase(),
    'Proxy already points to this implementation.'
  )

  const functionSignature = 'upgradeTo(address)'
  const callData = web3.eth.abi.encodeParameters(['address'], [implementation])
  await proxy.methods
    .upgradeTo(implementation)
    .call({ from: ADDRESSES.governance, gas: 12000000 })

  const name = 'Fix duplicate same-block reward claims'
  const description =
    `Upgrade ClaimsManagerProxy to ${implementation}. ` +
    'The new implementation preserves the verified mainnet storage layout and ABI, ' +
    'and changes the duplicate-claim guard so a claim is valid only when ' +
    'lastUserClaimBlock is strictly less than the current round funded block.'
  const result = await submitProposal({
    callData,
    description,
    execute,
    functionSignature,
    governance,
    name,
    registryKey: REGISTRY_KEYS.claimsManagerProxy,
    signer,
    target: ADDRESSES.claimsManagerProxy,
    web3
  })

  console.log(`mode=${execute ? 'execute' : 'dry-run'}`)
  console.log(`proposer=${signer}`)
  console.log(`implementation=${implementation}`)
  console.log(`registryKey=${REGISTRY_KEYS.claimsManagerProxy}`)
  console.log(`functionSignature=${functionSignature}`)
  console.log(`callData=${callData}`)
  console.log(`estimatedGas=${result.estimatedGas}`)
  if (result.receipt) {
    console.log(`proposalId=${result.proposalId}`)
    console.log(`transactionHash=${result.receipt.transactionHash}`)
  } else {
    console.log('No transaction sent. Re-run with --execute after review.')
  }
}

run(main)
