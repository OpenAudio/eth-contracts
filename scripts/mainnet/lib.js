const path = require('path')
const Web3 = require('web3')

const ROOT = path.resolve(__dirname, '../..')

const ADDRESSES = {
  audioToken: '0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998',
  claimsManagerProxy: '0x44617F9dCEd9787C3B06a05B35B4C779a2AA1334',
  currentClaimsManagerImplementation:
    '0x2426e87306D51a2Cf1d1d5e920904A8e103de3A7',
  delegateManager: '0x4d7968ebfD390D5E7926Cb3587C39eFf2F9FB225',
  governance: '0x4DEcA517D6817B6510798b7328F2314d3003AbAC',
  registry: '0xd976d3b4f4e22a238c1A736b6612D22f17b6f64C',
  serviceProviderFactory: '0xD17A9bc90c582249e211a4f4b16721e7f65156c8',
  staking: '0xe6D97B2099F142513be7A2a068bE040656Ae4591'
}

const SIGNERS = {
  deployer: '0xde21d46753633a177223faa6e56e8f6cd24cca04',
  proposer: '0x683A3C882e1DCD0A3012E2D45A47A9e8de8868d7'
}

const REGISTRY_KEYS = {
  claimsManagerProxy:
    '0x436c61696d734d616e6167657250726f78790000000000000000000000000000',
  delegateManager:
    '0x44656c65676174654d616e616765720000000000000000000000000000000000'
}

const INCIDENT = {
  exploitTransaction:
    '0xde6626086399691050971fa6656d61e21c1d114ceb098033521e94946c9e09d9',
  exitTransaction:
    '0xfe8037305908a1d66f0cab184b52ce32bd8a54f3be226b22c97d8da85c0e5c03',
  helper: '0x88e7d2E927bdeE9C6e108E8a52859e6f222A32bB',
  helperCodeHash:
    '0x56b48ba03ce4b28a206e1c3eaf9d4b82c9fe1dfb05dbb32fb0480ff6099afac5',
  owner: '0xb92b2e47680c89da8f951b8963ef469f461a50fc',
  slashAmount: '1956663379000963316690207'
}

const artifact = (name) => {
  try {
    return require(path.join(ROOT, 'build/contracts', `${name}.json`))
  } catch (error) {
    throw new Error(
      `Missing ${name} artifact. Run npm run truffle:compile-all before this script.`
    )
  }
}

const assertCondition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const sameAddress = (left, right) =>
  left && right && left.toLowerCase() === right.toLowerCase()

const assertAddress = (actual, expected, label) => {
  assertCondition(
    sameAddress(actual, expected),
    `${label}: expected ${expected}, got ${actual}`
  )
}

const isExecute = () => process.argv.includes('--execute')

const connect = async (expectedSigner) => {
  const rpcUrl = process.env.ETH_LIVE_NETWORK
  assertCondition(
    rpcUrl,
    'ETH_LIVE_NETWORK must contain the mainnet HTTPS RPC URL.'
  )

  const web3 = new Web3(
    new Web3.providers.HttpProvider(rpcUrl, {
      keepAlive: false,
      timeout: 30000
    })
  )
  const chainId = await web3.eth.getChainId()
  assertCondition(chainId === 1, `Refusing to run on chain ID ${chainId}.`)

  const execute = isExecute()
  const privateKey = process.env.ETH_WALLET_PRIVATE_KEY
  let signer = expectedSigner

  if (privateKey) {
    const trimmedKey = privateKey.trim()
    const normalizedKey = trimmedKey.startsWith('0x')
      ? trimmedKey
      : `0x${trimmedKey}`
    const account = web3.eth.accounts.privateKeyToAccount(normalizedKey)
    assertAddress(account.address, expectedSigner, 'Signer wallet')
    web3.eth.accounts.wallet.add(account)
    signer = account.address
  } else if (execute) {
    throw new Error(
      'ETH_WALLET_PRIVATE_KEY is required with --execute. Dry runs do not require it.'
    )
  }

  return { execute, signer, web3 }
}

const contract = (web3, name, address) =>
  new web3.eth.Contract(artifact(name).abi, address)

const assertCode = async (web3, address, label) => {
  const code = await web3.eth.getCode(address)
  assertCondition(code && code !== '0x', `${label} has no deployed code.`)
  return code
}

const assertRegistryEntry = async (web3, key, expected, label) => {
  const registry = contract(web3, 'Registry', ADDRESSES.registry)
  const actual = await registry.methods.getContract(key).call()
  assertAddress(actual, expected, `${label} registry entry`)
  return actual
}

const preflightGovernance = async (web3) => {
  const governance = contract(web3, 'Governance', ADDRESSES.governance)
  const registryAddress = await governance.methods.getRegistryAddress().call()
  assertAddress(registryAddress, ADDRESSES.registry, 'Governance registry')

  const upToDate = await governance.methods
    .inProgressProposalsAreUpToDate()
    .call()
  assertCondition(
    upToDate,
    'Governance has an evaluatable proposal that must be evaluated first.'
  )

  const [inProgress, maxInProgress] = await Promise.all([
    governance.methods.getInProgressProposals().call(),
    governance.methods.getMaxInProgressProposals().call()
  ])
  assertCondition(
    inProgress.length < Number(maxInProgress),
    'Governance already has the maximum number of in-progress proposals.'
  )

  return { governance, inProgress }
}

const formatAudio = (web3, amount) => {
  const value = web3.utils.toBN(amount)
  const base = web3.utils.toBN('1000000000000000000')
  const whole = value.div(base).toString(10)
  const fraction = value.mod(base).toString(10).padStart(18, '0')
  return `${whole}.${fraction}`
}

const estimateAndSend = async ({ execute, method, signer, web3 }) => {
  const estimatedGas = await method.estimateGas({ from: signer })
  const gas = Math.ceil(estimatedGas * 1.2)

  if (!execute) return { estimatedGas, gas, receipt: null }

  const gasPrice = await web3.eth.getGasPrice()
  const receipt = await method.send({ from: signer, gas, gasPrice })
  assertCondition(receipt.status, 'Transaction receipt reported failure.')
  return { estimatedGas, gas, receipt }
}

const verifyStoredProposal = async ({
  callData,
  functionSignature,
  governance,
  proposalId,
  registryKey,
  target
}) => {
  const proposal = await governance.methods.getProposalById(proposalId).call()
  assertAddress(
    proposal.targetContractAddress,
    target,
    'Stored proposal target'
  )
  assertCondition(
    proposal.targetContractRegistryKey.toLowerCase() ===
      registryKey.toLowerCase(),
    'Stored proposal registry key differs from the requested key.'
  )
  assertCondition(
    proposal.functionSignature === functionSignature,
    'Stored proposal function signature differs from the requested signature.'
  )
  assertCondition(
    proposal.callData.toLowerCase() === callData.toLowerCase(),
    'Stored proposal calldata differs from the requested calldata.'
  )
}

const submitProposal = async ({
  callData,
  description,
  execute,
  functionSignature,
  governance,
  name,
  registryKey,
  signer,
  target,
  web3
}) => {
  const method = governance.methods.submitProposal(
    registryKey,
    '0',
    functionSignature,
    callData,
    name,
    description
  )

  await method.call({ from: signer, gas: 12000000 })
  const result = await estimateAndSend({ execute, method, signer, web3 })

  if (!result.receipt) return result

  const event = result.receipt.events.ProposalSubmitted
  assertCondition(event, 'ProposalSubmitted event missing from receipt.')
  const proposalId = event.returnValues._proposalId
  await verifyStoredProposal({
    callData,
    functionSignature,
    governance,
    proposalId,
    registryKey,
    target
  })

  return { ...result, proposalId }
}

const run = (main) => {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(`ERROR: ${error.message}`)
      process.exit(1)
    }
  )
}

module.exports = {
  ADDRESSES,
  INCIDENT,
  REGISTRY_KEYS,
  SIGNERS,
  artifact,
  assertAddress,
  assertCode,
  assertCondition,
  assertRegistryEntry,
  connect,
  contract,
  estimateAndSend,
  formatAudio,
  isExecute,
  preflightGovernance,
  run,
  sameAddress,
  submitProposal
}
