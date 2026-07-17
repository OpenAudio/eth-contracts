const { SIGNERS, artifact, assertCondition, connect, run } = require('./lib')

const GAS_PRICE_MULTIPLIER_BPS = Number(
  process.env.DEPLOY_GAS_PRICE_MULTIPLIER_BPS || 20000
)

const main = async () => {
  const { execute, signer, web3 } = await connect(SIGNERS.deployer)
  assertCondition(
    Number.isSafeInteger(GAS_PRICE_MULTIPLIER_BPS) &&
      GAS_PRICE_MULTIPLIER_BPS >= 10000,
    'DEPLOY_GAS_PRICE_MULTIPLIER_BPS must be an integer of at least 10000.'
  )
  const claimsManagerV2 = artifact('ClaimsManagerV2')
  assertCondition(
    /^0x[0-9a-f]+$/i.test(claimsManagerV2.bytecode),
    'ClaimsManagerV2 creation bytecode is missing or contains unresolved links.'
  )
  assertCondition(
    /^0x[0-9a-f]+$/i.test(claimsManagerV2.deployedBytecode),
    'ClaimsManagerV2 runtime bytecode is missing or contains unresolved links.'
  )

  const deployment = new web3.eth.Contract(claimsManagerV2.abi).deploy({
    data: claimsManagerV2.bytecode
  })
  const [nonce, balance, networkGasPrice, estimatedGas] = await Promise.all([
    web3.eth.getTransactionCount(signer, 'pending'),
    web3.eth.getBalance(signer),
    web3.eth.getGasPrice(),
    deployment.estimateGas({ from: signer })
  ])
  const gas = Math.ceil(estimatedGas * 1.2)
  const gasPrice = web3.utils
    .toBN(networkGasPrice)
    .mul(web3.utils.toBN(GAS_PRICE_MULTIPLIER_BPS))
    .add(web3.utils.toBN(9999))
    .div(web3.utils.toBN(10000))
  const maxCost = web3.utils.toBN(gas).mul(web3.utils.toBN(gasPrice))
  assertCondition(
    web3.utils.toBN(balance).gte(maxCost),
    `Deployer balance is below the estimated maximum gas cost ${maxCost.toString(
      10
    )} wei.`
  )

  console.log(`mode=${execute ? 'execute' : 'dry-run'}`)
  console.log(`deployer=${signer}`)
  console.log(`pendingNonce=${nonce}`)
  console.log(`estimatedGas=${estimatedGas}`)
  console.log(`networkGasPrice=${networkGasPrice}`)
  console.log(`transactionGasPrice=${gasPrice.toString(10)}`)
  console.log(
    `runtimeCodeHash=${web3.utils.keccak256(claimsManagerV2.deployedBytecode)}`
  )

  if (!execute) {
    console.log('No transaction sent. Re-run with --execute after review.')
    return
  }

  let receipt
  const deployedContract = await deployment
    .send({ from: signer, gas, gasPrice })
    .on('receipt', (value) => {
      receipt = value
    })
  assertCondition(receipt && receipt.status, 'Deployment transaction failed.')
  const implementation = deployedContract.options.address
  const deployedCode = await web3.eth.getCode(implementation)
  assertCondition(
    web3.utils.keccak256(deployedCode) ===
      web3.utils.keccak256(claimsManagerV2.deployedBytecode),
    'Deployed runtime bytecode hash does not match the compiled artifact.'
  )
  console.log(`implementation=${implementation}`)
  console.log(`transactionHash=${receipt.transactionHash}`)
}

run(main)
