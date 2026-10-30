import * as lib from '../utils/lib.js'
const { expectEvent } = require('@openzeppelin/test-helpers')
const Incident = artifacts.require('AudiusTokenV2')
const Proxy = artifacts.require('AudiusAdminUpgradeabilityProxy')
const TARGET = '0xA97bF7836F8A08F9Ed91D41453D371493FAE8d10'
const key = web3.utils.utf8ToHex('Token')

contract('AudiusTokenV2', (accounts) => {
  const [, admin, guardian, holder, spender] = accounts
  const amount = web3.utils.toBN('27409671117810725934467774')
  let token, proxy, governance, original, implementation, before
  const execute = (signature, types = [], values = []) =>
    governance.guardianExecuteTransaction(
      key,
      '0',
      signature,
      lib.abiEncode(types, values),
      { from: guardian }
    )
  const burn = () => execute('burnBinanceIncidentBalance()')
  const snapshot = async () => ({
    supply: (await token.totalSupply()).toString(),
    holder: (await token.balanceOf(holder)).toString(),
    target: (await token.balanceOf(TARGET)).toString(),
    allowance: (await token.allowance(holder, spender)).toString(),
    domain: await token.DOMAIN_SEPARATOR(),
    name: await token.name(),
    symbol: await token.symbol()
  })
  beforeEach(async () => {
    await web3.eth.sendTransaction({
      from: guardian,
      to: TARGET,
      value: web3.utils.toWei('1', 'ether')
    })
    const registry = await lib.deployRegistry(artifacts, admin, guardian)
    governance = await lib.deployGovernance(
      artifacts,
      admin,
      guardian,
      registry,
      10,
      10,
      5,
      guardian
    )
    token = await lib.deployToken(
      artifacts,
      admin,
      guardian,
      guardian,
      governance.address
    )
    proxy = await Proxy.at(token.address)
    original = await proxy.implementation()
    await registry.addContract(key, token.address, { from: guardian })
    await token.transfer(TARGET, amount, { from: guardian })
    await token.transfer(holder, '100', { from: guardian })
    await token.approve(spender, '19', { from: holder })
    before = await snapshot()
    implementation = await Incident.new({ from: guardian })
    await execute('upgradeTo(address)', ['address'], [implementation.address])
    token = await Incident.at(token.address)
  })
  it('preserves existing state and starts unused without initialization', async () => {
    assert.deepEqual(await snapshot(), before)
    assert.isFalse(await token.binanceIncidentBurnExecuted())
    assert.equal(await token.BINANCE_INCIDENT_ACCOUNT(), TARGET)
  })
  it('burns the full live balance including deposits after upgrade, with both events', async () => {
    await token.transfer(TARGET, '7', { from: holder })
    const receipt = await burn()
    const live = amount.addn(7)
    await expectEvent.inTransaction(receipt.tx, Incident, 'Transfer', {
      from: TARGET,
      to: lib.addressZero,
      value: live
    })
    await expectEvent.inTransaction(
      receipt.tx,
      Incident,
      'BinanceIncidentBurn',
      { account: TARGET, amount: live }
    )
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      web3.utils.toBN(before.supply).sub(live).toString()
    )
    assert.isTrue(await token.binanceIncidentBurnExecuted())
    assert.equal((await token.balanceOf(holder)).toString(), '93')
  })
  it('burns the remaining balance after an outgoing transfer rather than reverting on a stale amount', async () => {
    await token.transfer(holder, '31', { from: TARGET })
    await burn()
    assert.equal((await token.balanceOf(TARGET)).toString(), '0')
    assert.equal((await token.balanceOf(holder)).toString(), '131')
    assert.equal(
      (await token.totalSupply()).toString(),
      web3.utils.toBN(before.supply).sub(amount).addn(31).toString()
    )
  })
  it('blocks repeats even after new deposits and implementation rollback/reinstallation', async () => {
    await burn()
    await token.transfer(TARGET, '11', { from: holder })
    await lib.assertRevert(burn(), 'Governance: Transaction failed.')
    await execute('upgradeTo(address)', ['address'], [original])
    await execute('upgradeTo(address)', ['address'], [implementation.address])
    assert.isTrue(await token.binanceIncidentBurnExecuted())
    await lib.assertRevert(burn(), 'Governance: Transaction failed.')
    assert.equal((await token.balanceOf(TARGET)).toString(), '11')
  })
  it('does not consume the operation if the address is empty', async () => {
    await token.transfer(holder, amount, { from: TARGET })
    await lib.assertRevert(burn(), 'Governance: Transaction failed.')
    assert.isFalse(await token.binanceIncidentBurnExecuted())
    await token.transfer(TARGET, '9', { from: holder })
    await burn()
    assert.isTrue(await token.binanceIncidentBurnExecuted())
  })
  it('rejects direct guardian, holders, minters and pausers', async () => {
    await execute('addMinter(address)', ['address'], [holder])
    await execute('addPauser(address)', ['address'], [spender])
    for (const caller of [guardian, admin, holder, spender, TARGET]) {
      await lib.assertRevert(
        token.burnBinanceIncidentBalance({ from: caller }),
        'AudiusToken: Only callable by Governance'
      )
    }
    assert.deepEqual(await snapshot(), before)
    assert.isFalse(await token.binanceIncidentBurnExecuted())
  })
  it('works while paused and leaves other holders and allowances intact', async () => {
    await execute('pause()')
    await burn()
    assert.isTrue(await token.paused())
    await lib.assertRevert(
      token.transfer(holder, '1', { from: guardian }),
      'Pausable: paused'
    )
    await execute('unpause()')
    await token.transferFrom(holder, spender, '5', { from: spender })
    await token.burn('2', { from: holder })
    await execute(
      'mint(address,uint256)',
      ['address', 'uint256'],
      [holder, '3']
    )
    assert.equal((await token.balanceOf(holder)).toString(), '96')
    assert.equal((await token.allowance(holder, spender)).toString(), '14')
  })
  it('rejects uninitialized implementations and reinitializing the upgraded proxy', async () => {
    await lib.assertRevert(
      implementation.burnBinanceIncidentBalance({ from: guardian }),
      'InitializableV2: Not initialized'
    )
    await lib.assertRevert(
      execute(
        'initialize(address,address)',
        ['address', 'address'],
        [guardian, governance.address]
      ),
      'Governance: Transaction failed.'
    )
    assert.deepEqual(await snapshot(), before)
  })
})
