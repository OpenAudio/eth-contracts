// Storage-layout verification, plus an optional isolated mainnet-fork integration test.
// No user private key is loaded and no transaction is sent to the upstream RPC.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Web3 = require('web3')

const ROOT = path.resolve(__dirname, '..')
const artifact = (name) =>
  require(path.join(ROOT, 'build/contracts', `${name}.json`))
const TOKEN = '0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998'
const GOVERNANCE = '0x4DEcA517D6817B6510798b7328F2314d3003AbAC'
const TARGET = '0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10'
const ORIGINAL_IMPLEMENTATION = '0x930C746a6e92ca8122682DF48CD5020bC1771b32'
const FORK_BLOCK = 26302886
const ZERO = '0x0000000000000000000000000000000000000000'

function checkStorageLayout() {
  const directory = path.join(
    require('@truffle/config').getTruffleDataDirectory(),
    'compilers/node_modules'
  )
  const compiler = fs
    .readdirSync(directory)
    .find((name) =>
      /^(solc-|soljson-).*v0\.5\.17\+commit\.d19bba13.*\.js$/.test(name)
    )
  assert(compiler, 'Compile with Truffle first to cache solc 0.5.17.')
  const soljson = require(path.join(directory, compiler))
  const sources = {}
  function add(file) {
    if (sources[file]) return
    const content = fs.readFileSync(
      path.join(ROOT, file.startsWith('@') ? `node_modules/${file}` : file),
      'utf8'
    )
    sources[file] = { content }
    for (const match of content.matchAll(/import\s+"([^"]+)"/g)) {
      add(
        match[1].startsWith('@')
          ? match[1]
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(file), match[1])
            )
      )
    }
  }
  add('contracts/erc20/AudiusTokenV2.sol')
  const output = JSON.parse(
    soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number'])(
      JSON.stringify({
        language: 'Solidity',
        sources,
        settings: { outputSelection: { '*': { '*': ['storageLayout'] } } }
      }),
      0,
      0
    )
  )
  assert(
    !(output.errors || []).some((error) => error.severity === 'error'),
    JSON.stringify(output.errors)
  )
  const old =
    output.contracts['contracts/erc20/AudiusToken.sol'].AudiusToken
      .storageLayout
  const upgraded =
    output.contracts['contracts/erc20/AudiusTokenV2.sol'].AudiusTokenV2
      .storageLayout
  // Contract names and AST IDs identify source declarations, not storage locations or types.
  const normalize = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        ['contract', 'astId'].includes(key) ? undefined : item
      )
    )
  assert.deepStrictEqual(normalize(old), normalize(upgraded))
  // Pin the 2022 recovery layout: comparing two unpatched builds is insufficient.
  for (const [label, slot, offset] of [
    ['proxyAdmin', '0', 0],
    ['initialized', '3', 0],
    ['initializing', '3', 1]
  ]) {
    const field = upgraded.storage.find((entry) => entry.label === label)
    assert(
      field && field.slot === slot && field.offset === offset,
      `Missing Audius initializer recovery patch: ${label} must be at slot ${slot}, offset ${offset}`
    )
  }
  const oldAbi = artifact('AudiusToken').abi
  const upgradedAbi = artifact('AudiusTokenV2').abi
  for (const entry of oldAbi)
    assert(
      upgradedAbi.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(entry)
      ),
      `Missing original ABI entry ${entry.name}`
    )
  const signature = (entry) =>
    `${entry.name}(${entry.inputs.map((input) => input.type).join(',')})`
  const oldFunctions = oldAbi
    .filter((entry) => entry.type === 'function')
    .map(signature)
  const added = upgradedAbi
    .filter((entry) => entry.type === 'function')
    .map(signature)
    .filter((name) => !oldFunctions.includes(name))
  assert.deepStrictEqual(
    added.sort(),
    ['BINANCE_INCIDENT_ACCOUNT()', 'burnBinanceIncidentBalance()'].sort()
  )
  const proxySelectors = artifact('AudiusAdminUpgradeabilityProxy')
    .abi.filter((entry) => entry.type === 'function')
    .map((entry) => Web3.utils.keccak256(signature(entry)).slice(0, 10))
  for (const name of added) {
    assert(
      !proxySelectors.includes(Web3.utils.keccak256(name).slice(0, 10)),
      'New method collides with a proxy selector'
    )
  }
  console.log(
    `PASS: identical compiler storage layout (${old.storage.length} entries); original ABI preserved; two new methods (constant getter and incident burn)`
  )
  return old.storage
}

async function mainnetFork(storage) {
  const url = process.env.AUDIO_FORK_RPC || 'https://eth.drpc.org'
  const upstream = new Web3(
    new Web3.providers.HttpProvider(url, { keepAlive: false, timeout: 30000 })
  )
  assert.strictEqual(await upstream.eth.getChainId(), 1)
  const sourceGovernance = new upstream.eth.Contract(
    artifact('GovernanceV2').abi,
    GOVERNANCE
  )
  const guardian = await sourceGovernance.methods
    .getGuardianAddress()
    .call({}, FORK_BLOCK)
  const provider = require('ganache').provider({
    fork: { url, blockNumber: FORK_BLOCK },
    chain: { chainId: 1337 },
    wallet: {
      totalAccounts: 3,
      defaultBalance: 1000,
      unlockedAccounts: [guardian, TARGET]
    },
    logging: { quiet: true }
  })
  try {
    const web3 = new Web3(provider)
    assert.strictEqual(await web3.eth.getChainId(), 1337)
    const [deployer, holder, spender] = await web3.eth.getAccounts()
    await provider.request({
      method: 'evm_setAccountBalance',
      params: [guardian, '0x3635c9adc5dea00000']
    })
    const token = new web3.eth.Contract(artifact('AudiusTokenV2').abi, TOKEN)
    const proxy = new web3.eth.Contract(
      artifact('AudiusAdminUpgradeabilityProxy').abi,
      TOKEN
    )
    const governance = new web3.eth.Contract(
      artifact('GovernanceV2').abi,
      GOVERNANCE
    )
    const execute = (signature, types, values) =>
      governance.methods
        .guardianExecuteTransaction(
          web3.utils.padRight(web3.utils.utf8ToHex('Token'), 64),
          '0',
          signature,
          web3.eth.abi.encodeParameters(types, values)
        )
        .send({ from: guardian, gas: 3000000 })
    const burn = (caller = spender) =>
      token.methods
        .burnBinanceIncidentBalance()
        .send({ from: caller, gas: 150000 })
    const mustRevert = async (action) => {
      let reverted = false
      try {
        await action()
      } catch (error) {
        assert(/revert/i.test(error.message), error.message)
        reverted = true
      }
      assert(reverted, 'Expected revert')
    }
    const permit = async (value) => {
      const deadline =
        Number((await web3.eth.getBlock('latest')).timestamp) + 3600
      const nonce = await token.methods.nonces(holder).call()
      const structHash = web3.utils.keccak256(
        web3.eth.abi.encodeParameters(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            await token.methods.PERMIT_TYPEHASH().call(),
            holder,
            spender,
            value,
            nonce,
            deadline
          ]
        )
      )
      const digest = web3.utils.keccak256(
        '0x1901' +
          (await token.methods.DOMAIN_SEPARATOR().call()).slice(2) +
          structHash.slice(2)
      )
      const privateKey =
        provider.getInitialAccounts()[holder.toLowerCase()].secretKey
      const sig = require('ethereumjs-util').ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(privateKey.slice(2), 'hex')
      )
      await token.methods
        .permit(
          holder,
          spender,
          value,
          deadline,
          sig.v,
          '0x' + sig.r.toString('hex'),
          '0x' + sig.s.toString('hex')
        )
        .send({ from: deployer, gas: 200000 })
    }
    const snapshot = async () => {
      const balances = {}
      for (const address of [
        TARGET,
        GOVERNANCE,
        holder,
        spender,
        '0x28C6c06298d514Db089934071355E5743bf21d60'
      ])
        balances[address] = await token.methods.balanceOf(address).call()
      const slots = {}
      for (const slot of [...new Set(storage.map((entry) => entry.slot))])
        slots[slot] = await web3.eth.getStorageAt(TOKEN, slot)
      return {
        balances,
        slots,
        supply: await token.methods.totalSupply().call(),
        name: await token.methods.name().call(),
        symbol: await token.methods.symbol().call(),
        decimals: await token.methods.decimals().call(),
        domain: await token.methods.DOMAIN_SEPARATOR().call(),
        nonce: await token.methods.nonces(holder).call(),
        allowance: await token.methods.allowance(holder, spender).call(),
        targetAllowance: await token.methods.allowance(TARGET, spender).call(),
        minter: await token.methods.isMinter(GOVERNANCE).call(),
        pauser: await token.methods.isPauser(GOVERNANCE).call(),
        paused: await token.methods.paused().call()
      }
    }
    assert.strictEqual(
      (await proxy.methods.implementation().call()).toLowerCase(),
      ORIGINAL_IMPLEMENTATION.toLowerCase()
    )
    assert.strictEqual(
      (await proxy.methods.getAudiusProxyAdminAddress().call()).toLowerCase(),
      GOVERNANCE.toLowerCase()
    )
    await execute(
      'mint(address,uint256)',
      ['address', 'uint256'],
      [holder, '100']
    )
    await permit('19')
    await provider.request({
      method: 'evm_setAccountBalance',
      params: [TARGET, '0x3635c9adc5dea00000']
    })
    await token.methods
      .approve(spender, '100')
      .send({ from: TARGET, gas: 100000 })
    await token.methods.transfer(holder, '1').call({ from: TARGET })
    const before = await snapshot()
    assert.strictEqual(before.balances[TARGET], '27409671117810725934467774')
    const initializerFlags = web3.utils.toBN(before.slots['3'])
    assert.strictEqual(
      initializerFlags.and(web3.utils.toBN('255')).toNumber(),
      1,
      'Mainnet initialized flag must be true at slot 3 offset 0'
    )
    assert.strictEqual(
      initializerFlags.shrn(8).and(web3.utils.toBN('255')).toNumber(),
      0,
      'Mainnet initializing flag must be false at slot 3 offset 1'
    )
    const implementation = await new web3.eth.Contract(
      artifact('AudiusTokenV2').abi
    )
      .deploy({ data: artifact('AudiusTokenV2').bytecode })
      .send({ from: deployer, gas: 6000000 })
    await execute(
      'upgradeTo(address)',
      ['address'],
      [implementation.options.address]
    )
    assert.deepStrictEqual(await snapshot(), before)
    for (const [signature, values] of [
      ['initialize()', []],
      ['initialize(address)', [deployer]],
      ['initialize(address,address)', [deployer, GOVERNANCE]],
      ['initialize(string,string,uint8)', ['Changed', 'BAD', '6']]
    ]) {
      for (const [caller, reason] of [
        [deployer, 'Only proxy admin can initialize'],
        [guardian, 'Only proxy admin can initialize'],
        [GOVERNANCE, 'Contract instance has already been initialized']
      ]) {
        await assert.rejects(
          token.methods[signature](...values).call({ from: caller }),
          (error) => error.message.includes(reason),
          `${signature} must reject ${caller} with ${reason}`
        )
      }
    }
    assert.deepStrictEqual(await snapshot(), before)
    console.log(
      'PASS: 2022 initializer flags remain at slot 3; all four inherited initializers reject outsiders, the guardian directly, and Governance after upgrade'
    )
    console.log(
      `PASS: mainnet proxy upgrade at fork block ${FORK_BLOCK}; sampled balances, raw storage, roles, metadata, permit nonce and allowances preserved`
    )
    assert.strictEqual(
      await token.methods.BINANCE_INCIDENT_ACCOUNT().call(),
      TARGET
    )
    await assert.rejects(
      token.methods.transfer(holder, '1').call({ from: TARGET }),
      /Incident account frozen/
    )
    await assert.rejects(
      token.methods.transferFrom(TARGET, holder, '1').call({ from: spender }),
      /Incident account frozen/
    )
    await mustRevert(() =>
      token.methods
        .transferFrom(TARGET, holder, '1')
        .send({ from: spender, gas: 150000 })
    )
    assert.deepStrictEqual(await snapshot(), before)
    // Newly granted allowances cannot bypass the same transfer guard.
    await token.methods
      .approve(spender, '200')
      .send({ from: TARGET, gas: 100000 })
    await assert.rejects(
      token.methods.transferFrom(TARGET, holder, '1').call({ from: spender }),
      /Incident account frozen/
    )
    assert.strictEqual(
      await token.methods.allowance(TARGET, spender).call(),
      '200'
    )
    await permit('23')
    await token.methods
      .transferFrom(holder, spender, '5')
      .send({ from: spender, gas: 150000 })
    const beforeBurn = await snapshot()
    const receipt = await burn()
    const afterBurn = await snapshot()
    assert.strictEqual(afterBurn.balances[TARGET], '0')
    assert.strictEqual(
      afterBurn.supply,
      web3.utils
        .toBN(beforeBurn.supply)
        .sub(web3.utils.toBN(before.balances[TARGET]))
        .toString()
    )
    for (const address of Object.keys(beforeBurn.balances).filter(
      (address) => address !== TARGET
    ))
      assert.strictEqual(
        afterBurn.balances[address],
        beforeBurn.balances[address]
      )
    for (const field of [
      'name',
      'symbol',
      'decimals',
      'domain',
      'nonce',
      'allowance',
      'targetAllowance',
      'minter',
      'pauser',
      'paused'
    ])
      assert.deepStrictEqual(afterBurn[field], beforeBurn[field])
    const events = await token.getPastEvents('Transfer', {
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
    })
    assert(
      events.some(
        (event) =>
          event.returnValues.from.toLowerCase() === TARGET.toLowerCase() &&
          event.returnValues.to === ZERO &&
          event.returnValues.value === before.balances[TARGET]
      )
    )
    const empty = await snapshot()
    await burn(holder)
    assert.deepStrictEqual(await snapshot(), empty)
    await token.methods
      .transfer(TARGET, '7')
      .send({ from: holder, gas: 150000 })
    await assert.rejects(
      token.methods.transfer(holder, '1').call({ from: TARGET }),
      /Incident account frozen/
    )
    const supply = await token.methods.totalSupply().call()
    await burn(deployer)
    assert.strictEqual(await token.methods.balanceOf(TARGET).call(), '0')
    assert.strictEqual(
      await token.methods.totalSupply().call(),
      web3.utils.toBN(supply).subn(7).toString()
    )
    console.log(
      'PASS: immediate transfer/transferFrom freeze with old and new allowances; permissionless full-balance burn, supply/event accounting, empty repeat and later-deposit burn; other holders retain signed permit/transferFrom'
    )
  } finally {
    await provider.disconnect()
  }
}

async function main() {
  const storage = checkStorageLayout()
  if (process.argv.includes('--fork')) await mainnetFork(storage)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error.message)
    process.exit(1)
  }
)
