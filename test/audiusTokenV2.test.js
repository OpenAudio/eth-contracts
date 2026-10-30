import * as _lib from '../utils/lib.js'
import * as signatures from '../utils/signatures.js'
const { expectEvent } = require('@openzeppelin/test-helpers')

const AudiusToken = artifacts.require('AudiusToken')
const AudiusTokenV2 = artifacts.require('AudiusTokenV2')
const Proxy = artifacts.require('AudiusAdminUpgradeabilityProxy')
const key = web3.utils.utf8ToHex('Token')

contract('AudiusTokenV2', (accounts) => {
  const [, proxyAdmin, deployer, holder, other, spender, minter, pauser] =
    accounts
  const TARGET = '0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10'
  const frozen = 'AudiusToken: Incident account frozen'
  const guardian = deployer
  const amount = web3.utils.toBN('27409671117810725934467774')
  const permitOwner = '0xaaa30A4bB636F15be970f571BcBe502005E9D66b'
  const permitKey = Buffer.from(
    '76195632b07afded1ae36f68635b6ff86791bd4579a27ca28ec7e539fed65c0e',
    'hex'
  )
  let token, proxy, governance, implementation, beforeUpgrade

  const execute = (signature, types, args) =>
    governance.guardianExecuteTransaction(
      key,
      '0',
      signature,
      _lib.abiEncode(types, args),
      { from: guardian }
    )
  const burn = (caller = other) =>
    token.burnBinanceIncidentBalance({ from: caller })
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      web3.currentProvider.send(
        { jsonrpc: '2.0', id: Date.now(), method, params },
        (error, result) => {
          if (error || result.error)
            reject(error || new Error(result.error.message))
          else resolve(result.result)
        }
      )
    })
  before(async () => {
    // Local Ganache impersonation only; no incident private key is used.
    assert.equal(await web3.eth.getChainId(), 1337)
    await rpc('evm_addAccount', [TARGET, 'local-test'])
    await rpc('personal_unlockAccount', [TARGET, 'local-test', 0])
    await rpc('evm_setAccountBalance', [TARGET, '0x3635c9adc5dea00000'])
  })
  const state = async () => ({
    name: await token.name(),
    symbol: await token.symbol(),
    decimals: (await token.decimals()).toString(),
    supply: (await token.totalSupply()).toString(),
    domain: await token.DOMAIN_SEPARATOR(),
    nonce: (await token.nonces(permitOwner)).toString(),
    target: (await token.balanceOf(TARGET)).toString(),
    targetAllowance: (await token.allowance(TARGET, spender)).toString(),
    holder: (await token.balanceOf(holder)).toString(),
    other: (await token.balanceOf(other)).toString(),
    owner: (await token.balanceOf(deployer)).toString(),
    allowance: (await token.allowance(holder, spender)).toString(),
    permitAllowance: (await token.allowance(permitOwner, spender)).toString(),
    governanceMinter: await token.isMinter(governance.address),
    governancePauser: await token.isPauser(governance.address),
    extraMinter: await token.isMinter(minter),
    extraPauser: await token.isPauser(pauser),
    paused: await token.paused()
  })

  beforeEach(async () => {
    const registry = await _lib.deployRegistry(artifacts, proxyAdmin, deployer)
    governance = await _lib.deployGovernance(
      artifacts,
      proxyAdmin,
      deployer,
      registry,
      10,
      10,
      5,
      guardian
    )
    token = await _lib.deployToken(
      artifacts,
      proxyAdmin,
      deployer,
      deployer,
      governance.address
    )
    proxy = await Proxy.at(token.address)
    await registry.addContract(key, token.address, { from: deployer })
    await token.transfer(TARGET, amount, { from: deployer })
    await token.approve(spender, '100', { from: TARGET })
    await token.transfer(holder, '1000', { from: deployer })
    await token.transfer(other, '12345', { from: deployer })
    await token.approve(spender, '17', { from: holder })
    await execute('addMinter(address)', ['address'], [minter])
    await execute('addPauser(address)', ['address'], [pauser])
    // Seed a nonzero permit nonce and allowance on the original implementation.
    const deadline = (await web3.eth.getBlock('latest')).timestamp + 3600
    const digest = signatures.getPermitDigest(
      'Audius',
      token.address,
      1337,
      { owner: permitOwner, spender, value: '19' },
      0,
      deadline
    )
    const sig = signatures.sign(digest, permitKey)
    await token.permit(
      permitOwner,
      spender,
      '19',
      deadline,
      sig.v,
      sig.r,
      sig.s,
      { from: other }
    )
    beforeUpgrade = await state()
    implementation = await AudiusTokenV2.new({ from: deployer })
    await execute('upgradeTo(address)', ['address'], [implementation.address])
    token = await AudiusTokenV2.at(token.address)
  })

  it('preserves balances, allowances, permit state, metadata, supply and roles across upgrade', async () => {
    assert.deepEqual(await state(), beforeUpgrade)
    assert.equal(await proxy.implementation(), implementation.address)
    assert.equal(await proxy.getAudiusProxyAdminAddress(), governance.address)
  })

  it('freezes direct transfers immediately, including zero and self transfers', async () => {
    for (const [recipient, value] of [
      [other, '1'],
      [TARGET, '1'],
      [other, '0']
    ]) {
      await _lib.assertRevert(
        token.transfer(recipient, value, { from: TARGET }),
        frozen
      )
    }
    assert.deepEqual(await state(), beforeUpgrade)
  })

  it('blocks transferFrom with pre-upgrade and new allowances without consuming them', async () => {
    await _lib.assertRevert(
      token.transferFrom(TARGET, other, '1', { from: spender }),
      frozen
    )
    assert.deepEqual(await state(), beforeUpgrade)
    // approve and permit both write the same allowance consumed by transferFrom.
    await token.approve(spender, '200', { from: TARGET })
    await token.increaseAllowance(spender, '1', { from: TARGET })
    await token.decreaseAllowance(spender, '1', { from: TARGET })
    for (const value of ['0', '1', '200']) {
      await _lib.assertRevert(
        token.transferFrom(TARGET, other, value, { from: spender }),
        frozen
      )
    }
    assert.deepEqual(
      await state(),
      Object.assign({}, beforeUpgrade, { targetAllowance: '200' })
    )
  })

  it('lets an unrelated caller burn only the entire incident balance without allowance or reward', async () => {
    assert.equal(await token.BINANCE_INCIDENT_ACCOUNT(), TARGET)
    assert.equal((await token.allowance(TARGET, other)).toString(), '0')
    const receipt = await burn()
    expectEvent(receipt, 'Transfer', {
      from: TARGET,
      to: _lib.addressZero,
      value: amount
    })
    assert.deepEqual(
      await state(),
      Object.assign({}, beforeUpgrade, {
        target: '0',
        supply: web3.utils.toBN(beforeUpgrade.supply).sub(amount).toString()
      })
    )
  })

  it('burns the live balance including deposits since upgrade and allows later deposits to be burned again', async () => {
    await token.transfer(TARGET, '29', { from: deployer })
    let supply = await token.totalSupply()
    await burn(holder)
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      supply.sub(amount).subn(29).toString()
    )
    // Both transfers and authorized minting can credit the frozen address.
    await token.transfer(TARGET, '7', { from: other })
    await token.mint(TARGET, '11', { from: minter })
    await _lib.assertRevert(
      token.transfer(other, '1', { from: TARGET }),
      frozen
    )
    supply = await token.totalSupply()
    const receipt = await burn(spender)
    expectEvent(receipt, 'Transfer', {
      from: TARGET,
      to: _lib.addressZero,
      value: web3.utils.toBN(18)
    })
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      supply.subn(18).toString()
    )
  })

  it('allows repeat empty burns with zero supply change and keeps the empty account frozen', async () => {
    await burn()
    const pre = await state()
    const receipt = await burn(holder)
    expectEvent(receipt, 'Transfer', {
      from: TARGET,
      to: _lib.addressZero,
      value: web3.utils.toBN(0)
    })
    assert.deepEqual(await state(), pre)
    await _lib.assertRevert(
      token.transfer(other, '0', { from: TARGET }),
      frozen
    )
  })

  it('burns while paused and keeps the targeted freeze after unpause', async () => {
    await token.pause({ from: pauser })
    await burn()
    assert.isTrue(await token.paused())
    assert.equal((await token.balanceOf(other)).toString(), beforeUpgrade.other)
    await _lib.assertRevert(
      token.transfer(other, '1', { from: holder }),
      'Pausable: paused'
    )
    await token.unpause({ from: pauser })
    await token.transfer(other, '1', { from: holder })
    await token.transfer(TARGET, '1', { from: holder })
    await _lib.assertRevert(
      token.transfer(other, '1', { from: TARGET }),
      frozen
    )
  })

  it('preserves ordinary transfers, allowance checks, burns, minting and signed permits for other holders', async () => {
    await token.transfer(other, '5', { from: holder })
    await token.transferFrom(holder, other, '3', { from: spender })
    await _lib.assertRevert(
      token.transferFrom(holder, other, '15', { from: spender }),
      'ERC20: transfer amount exceeds allowance'
    )
    await _lib.assertRevert(
      token.burnFrom(holder, '15', { from: spender }),
      'ERC20: burn amount exceeds allowance'
    )
    await token.burnFrom(holder, '7', { from: spender })
    await token.burn('11', { from: holder })
    await token.mint(other, '13', { from: minter })
    await token.transfer(permitOwner, '23', { from: deployer })
    const deadline = (await web3.eth.getBlock('latest')).timestamp + 3600
    const digest = signatures.getPermitDigest(
      'Audius',
      token.address,
      1337,
      { owner: permitOwner, spender, value: '23' },
      1,
      deadline
    )
    const sig = signatures.sign(digest, permitKey)
    await token.permit(
      permitOwner,
      spender,
      '23',
      deadline,
      sig.v,
      sig.r,
      sig.s,
      { from: other }
    )
    await token.transferFrom(permitOwner, other, '5', { from: spender })
    assert.equal((await token.nonces(permitOwner)).toString(), '2')
    assert.equal((await token.allowance(permitOwner, spender)).toString(), '18')
    assert.equal((await token.allowance(holder, spender)).toString(), '7')
    assert.equal((await token.balanceOf(holder)).toString(), '974')
    // A signature for a different holder cannot grant a target allowance.
    await _lib.assertRevert(
      token.permit(TARGET, spender, '23', deadline, sig.v, sig.r, sig.s, {
        from: other
      }),
      'AudiusToken: Invalid signature'
    )
    assert.equal((await token.nonces(TARGET)).toString(), '0')
    assert.equal((await token.balanceOf(TARGET)).toString(), amount.toString())
  })

  it('preserves existing voluntary burns from the incident account without letting tokens escape', async () => {
    await token.burn('3', { from: TARGET })
    await token.burnFrom(TARGET, '7', { from: spender })
    await burn()
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      web3.utils.toBN(beforeUpgrade.supply).sub(amount).toString()
    )
  })

  it('rejects uninitialized calls and every inherited reinitializer after upgrade', async () => {
    await _lib.assertRevert(
      implementation.burnBinanceIncidentBalance({ from: other }),
      'InitializableV2: Not initialized'
    )
    const emptyProxy = await Proxy.new(
      implementation.address,
      governance.address,
      '0x',
      { from: deployer }
    )
    const emptyToken = await AudiusTokenV2.at(emptyProxy.address)
    await _lib.assertRevert(
      emptyToken.burnBinanceIncidentBalance({ from: other }),
      'InitializableV2: Not initialized'
    )
    for (const [signature, types, values] of [
      ['initialize()', [], []],
      ['initialize(address)', ['address'], [other]],
      [
        'initialize(address,address)',
        ['address', 'address'],
        [other, governance.address]
      ],
      [
        'initialize(string,string,uint8)',
        ['string', 'string', 'uint8'],
        ['Changed', 'BAD', '6']
      ]
    ]) {
      await _lib.assertRevert(
        implementation.contract.methods[signature](...values).call({
          from: other
        }),
        'Only proxy admin can initialize'
      )
      await _lib.assertRevert(
        token.contract.methods[signature](...values).call({ from: other }),
        'Only proxy admin can initialize'
      )
      await _lib.assertRevert(
        token.contract.methods[signature](...values).call({
          from: governance.address
        }),
        'Contract instance has already been initialized'
      )
      await _lib.assertRevert(
        execute(signature, types, values),
        'Governance: Transaction failed.'
      )
    }
    assert.deepEqual(await state(), beforeUpgrade)
  })

  it('allows governance to roll back the freeze but cannot restore burned tokens', async () => {
    await burn()
    await token.transfer(TARGET, '7', { from: deployer })
    const original = await AudiusToken.new({ from: deployer })
    await execute('upgradeTo(address)', ['address'], [original.address])
    const restored = await AudiusToken.at(token.address)
    const supply = await token.totalSupply()
    await restored.transfer(other, '7', { from: TARGET })
    assert.equal((await restored.balanceOf(TARGET)).toString(), '0')
    assert.equal((await restored.totalSupply()).toString(), supply.toString())
    await _lib.assertRevert(burn())
    await execute('upgradeTo(address)', ['address'], [implementation.address])
    await token.transfer(TARGET, '9', { from: deployer })
    await _lib.assertRevert(
      token.transfer(other, '1', { from: TARGET }),
      frozen
    )
    await burn()
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
  })
})
