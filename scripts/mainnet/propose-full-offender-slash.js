const {
  ADDRESSES,
  INCIDENT,
  REGISTRY_KEYS,
  SIGNERS,
  assertAddress,
  assertCode,
  assertCondition,
  assertRegistryEntry,
  connect,
  contract,
  formatAudio,
  preflightGovernance,
  run,
  submitProposal
} = require('./lib')

const SAFETY_BUFFER_BLOCKS = Number(
  process.env.SLASH_PROPOSAL_SAFETY_BUFFER_BLOCKS || 1000
)

const main = async () => {
  const { execute, signer, web3 } = await connect(SIGNERS.proposer)
  assertCondition(
    Number.isSafeInteger(SAFETY_BUFFER_BLOCKS) && SAFETY_BUFFER_BLOCKS >= 0,
    'SLASH_PROPOSAL_SAFETY_BUFFER_BLOCKS must be a non-negative integer.'
  )

  const { governance, inProgress } = await preflightGovernance(web3)
  assertCondition(
    inProgress.length === 0,
    'Refusing exact full-balance slash while another proposal is in progress.'
  )
  await assertRegistryEntry(
    web3,
    REGISTRY_KEYS.delegateManager,
    ADDRESSES.delegateManager,
    'DelegateManager'
  )

  const [helperCode, currentBlock, votingPeriod, executionDelay] =
    await Promise.all([
      assertCode(web3, INCIDENT.helper, 'Incident helper'),
      web3.eth.getBlockNumber(),
      governance.methods.getVotingPeriod().call(),
      governance.methods.getExecutionDelay().call()
    ])
  assertCondition(
    web3.utils.keccak256(helperCode) === INCIDENT.helperCodeHash,
    'Incident helper bytecode hash changed from the validated exploit contract.'
  )

  const helper = new web3.eth.Contract(
    [
      {
        constant: true,
        inputs: [],
        name: 'owner',
        outputs: [{ name: '', type: 'address' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
      }
    ],
    INCIDENT.helper
  )
  const staking = contract(web3, 'Staking', ADDRESSES.staking)
  const serviceProviderFactory = contract(
    web3,
    'ServiceProviderFactory',
    ADDRESSES.serviceProviderFactory
  )
  const delegateManager = contract(
    web3,
    'DelegateManagerV2',
    ADDRESSES.delegateManager
  )
  const token = contract(web3, 'AudiusToken', ADDRESSES.audioToken)

  const [
    owner,
    stakedBalance,
    pendingExit,
    providerDetails,
    helperLiquidBalance,
    ownerLiquidBalance
  ] = await Promise.all([
    helper.methods.owner().call(),
    staking.methods.totalStakedFor(INCIDENT.helper).call(),
    serviceProviderFactory.methods
      .getPendingDecreaseStakeRequest(INCIDENT.helper)
      .call(),
    serviceProviderFactory.methods
      .getServiceProviderDetails(INCIDENT.helper)
      .call(),
    token.methods.balanceOf(INCIDENT.helper).call(),
    token.methods.balanceOf(INCIDENT.owner).call()
  ])
  assertAddress(owner, INCIDENT.owner, 'Incident helper owner')
  assertCondition(
    stakedBalance === INCIDENT.slashAmount,
    `Validated slash amount changed: expected ${INCIDENT.slashAmount}, got ${stakedBalance}.`
  )
  assertCondition(
    pendingExit.amount === stakedBalance,
    'Pending exit amount is not exactly equal to the full staked balance.'
  )
  assertCondition(
    Number(providerDetails.numberOfEndpoints) === 0,
    'Incident helper unexpectedly has a registered endpoint.'
  )
  assertCondition(
    helperLiquidBalance === '0' && ownerLiquidBalance === '0',
    'Incident helper or owner now has liquid AUDIO; revalidate the desired penalty scope.'
  )

  const earliestEvaluationBlock =
    currentBlock + Number(votingPeriod) + Number(executionDelay) + 1
  const exitExpiryBlock = Number(pendingExit.lockupExpiryBlock)
  assertCondition(
    earliestEvaluationBlock + SAFETY_BUFFER_BLOCKS < exitExpiryBlock,
    `Insufficient timing margin: earliest evaluation ${earliestEvaluationBlock}, ` +
      `safety buffer ${SAFETY_BUFFER_BLOCKS}, exit expiry ${exitExpiryBlock}.`
  )

  const functionSignature = 'slash(uint256,address)'
  const callData = web3.eth.abi.encodeParameters(
    ['uint256', 'address'],
    [INCIDENT.slashAmount, INCIDENT.helper]
  )
  await delegateManager.methods
    .slash(INCIDENT.slashAmount, INCIDENT.helper)
    .call({ from: ADDRESSES.governance, gas: 12000000 })

  const amountAudio = formatAudio(web3, INCIDENT.slashAmount)
  const name = 'Slash reward-claim exploit service provider'
  const description =
    `Slash ${amountAudio} AUDIO staked balance of service provider ` +
    `${INCIDENT.helper} and cancel its pending withdrawal. ` +
    `The service provider executed a same-block reward-claim exploit in ` +
    `${INCIDENT.exploitTransaction} and requested exit in ${INCIDENT.exitTransaction}.`
  const result = await submitProposal({
    callData,
    description,
    execute,
    functionSignature,
    governance,
    name,
    registryKey: REGISTRY_KEYS.delegateManager,
    signer,
    target: ADDRESSES.delegateManager,
    web3
  })

  console.log(`mode=${execute ? 'execute' : 'dry-run'}`)
  console.log(`proposer=${signer}`)
  console.log(`serviceProvider=${INCIDENT.helper}`)
  console.log(`slashAmountBaseUnits=${INCIDENT.slashAmount}`)
  console.log(`slashAmountAudio=${amountAudio}`)
  console.log(`currentBlock=${currentBlock}`)
  console.log(`earliestEvaluationBlock=${earliestEvaluationBlock}`)
  console.log(`exitExpiryBlock=${exitExpiryBlock}`)
  console.log(`safetyMarginBlocks=${exitExpiryBlock - earliestEvaluationBlock}`)
  console.log(`registryKey=${REGISTRY_KEYS.delegateManager}`)
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
