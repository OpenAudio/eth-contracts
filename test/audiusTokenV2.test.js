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
  const guardian = deployer
  const amount = web3.utils.toBN('27409671117810725934467774')
  const permitOwner = '0xaaa30A4bB636F15be970f571BcBe502005E9D66b'
  const permitKey = Buffer.from(
    '76195632b07afded1ae36f68635b6ff86791bd4579a27ca28ec7e539fed65c0e',
    'hex'
  )
  let token, proxy, governance, implementation, before

  const execute = (signature, types, args) =>
    governance.guardianExecuteTransaction(
      key,
      '0',
      signature,
      _lib.abiEncode(types, args),
      { from: guardian }
    )
  const burn = (account, value = amount) =>
    execute(
      'governanceBurn(address,uint256)',
      ['address', 'uint256'],
      [account, value.toString()]
    )
  const state = async () => ({
    name: await token.name(),
    symbol: await token.symbol(),
    decimals: (await token.decimals()).toString(),
    supply: (await token.totalSupply()).toString(),
    domain: await token.DOMAIN_SEPARATOR(),
    nonce: (await token.nonces(permitOwner)).toString(),
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
    await token.transfer(holder, amount, { from: deployer })
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
    before = await state()
    implementation = await AudiusTokenV2.new({ from: deployer })
    await execute('upgradeTo(address)', ['address'], [implementation.address])
    token = await AudiusTokenV2.at(token.address)
  })

  it('preserves balances, allowances, permit state, metadata, supply and roles across upgrade', async () => {
    assert.deepEqual(await state(), before)
    assert.equal(await proxy.implementation(), implementation.address)
    assert.equal(await proxy.getAudiusProxyAdminAddress(), governance.address)
  })

  it('burns a full balance above Number.MAX_SAFE_INTEGER without allowance and emits the ERC20 burn event', async () => {
    assert.equal(
      (await token.allowance(holder, governance.address)).toString(),
      '0'
    )
    const receipt = await burn(holder)
    await expectEvent.inTransaction(receipt.tx, AudiusTokenV2, 'Transfer', {
      from: holder,
      to: _lib.addressZero,
      value: amount
    })
    assert.equal((await token.balanceOf(holder)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      web3.utils.toBN(before.supply).sub(amount).toString()
    )
    assert.deepEqual(
      await state(),
      Object.assign({}, before, {
        holder: '0',
        supply: web3.utils.toBN(before.supply).sub(amount).toString()
      })
    )
  })

  it('rejects holders, EOAs, the guardian directly, minters and pausers', async () => {
    for (const caller of [
      holder,
      other,
      guardian,
      proxyAdmin,
      minter,
      pauser
    ]) {
      await _lib.assertRevert(
        token.governanceBurn(holder, amount, { from: caller }),
        'AudiusToken: Only callable by Governance'
      )
    }
    assert.deepEqual(await state(), before)
  })

  it('burns exact amounts from arbitrary accounts without including subsequent deposits', async () => {
    await token.transfer(holder, '29', { from: deployer })
    const supply = await token.totalSupply()
    await burn(holder)
    await burn(other, '12345')
    assert.equal((await token.balanceOf(holder)).toString(), '29')
    assert.equal((await token.balanceOf(other)).toString(), '0')
    assert.equal(
      (await token.totalSupply()).toString(),
      supply.sub(amount).sub(web3.utils.toBN('12345')).toString()
    )
  })

  it('rejects an amount above the remaining balance atomically', async () => {
    await token.transfer(other, '31', { from: holder })
    const pre = await state()
    await _lib.assertRevert(burn(holder), 'Governance: Transaction failed.')
    assert.deepEqual(await state(), pre)
    await burn(holder, amount.subn(31))
    assert.equal((await token.balanceOf(holder)).toString(), '0')
    assert.equal((await token.balanceOf(other)).toString(), '12376')
  })

  it('burns partial amounts and permits zero burns without changing supply', async () => {
    await burn(holder, '1')
    assert.equal(
      (await token.balanceOf(holder)).toString(),
      amount.subn(1).toString()
    )
    assert.equal(
      (await token.totalSupply()).toString(),
      web3.utils.toBN(before.supply).subn(1).toString()
    )
    const pre = await state()
    await burn(holder, '0')
    await burn(accounts[20], '0')
    assert.deepEqual(await state(), pre)
    await _lib.assertRevert(
      burn(accounts[20], '1'),
      'Governance: Transaction failed.'
    )
    await _lib.assertRevert(
      burn(holder, web3.utils.toBN('2').pow(web3.utils.toBN('256')).subn(1)),
      'Governance: Transaction failed.'
    )
    assert.deepEqual(await state(), pre)
  })

  it('rejects the zero address and leaves all state unchanged', async () => {
    await _lib.assertRevert(
      burn(_lib.addressZero),
      'Governance: Transaction failed.'
    )
    assert.deepEqual(await state(), before)
  })

  it('works while paused without unpausing or changing other holders', async () => {
    await token.pause({ from: pauser })
    await burn(holder)
    assert.isTrue(await token.paused())
    assert.equal((await token.balanceOf(other)).toString(), before.other)
    await _lib.assertRevert(
      token.transfer(other, '1', { from: deployer }),
      'Pausable: paused'
    )
    await token.unpause({ from: pauser })
    await token.transfer(other, '1', { from: deployer })
  })

  it('retains ordinary burn, allowance checks, minting and permit functionality', async () => {
    await _lib.assertRevert(
      token.burnFrom(holder, '18', { from: spender }),
      'ERC20: burn amount exceeds allowance'
    )
    await token.burnFrom(holder, '7', { from: spender })
    await token.burn('11', { from: holder })
    await token.mint(other, '13', { from: minter })
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
    assert.equal((await token.nonces(permitOwner)).toString(), '2')
    assert.equal((await token.allowance(permitOwner, spender)).toString(), '23')
    assert.equal((await token.allowance(holder, spender)).toString(), '10')
    assert.equal(
      (await token.balanceOf(holder)).toString(),
      amount.subn(18).toString()
    )
  })

  it('follows the current proxy admin and does not grant the previous governance residual burn authority', async () => {
    const registry2 = await _lib.deployRegistry(artifacts, proxyAdmin, deployer)
    const governance2 = await _lib.deployGovernance(
      artifacts,
      proxyAdmin,
      deployer,
      registry2,
      10,
      10,
      5,
      guardian
    )
    await registry2.addContract(key, token.address, { from: deployer })
    await execute(
      'setAudiusProxyAdminAddress(address)',
      ['address'],
      [governance2.address]
    )
    await _lib.assertRevert(burn(holder), 'Governance: Transaction failed.')
    await governance2.guardianExecuteTransaction(
      key,
      '0',
      'governanceBurn(address,uint256)',
      _lib.abiEncode(['address', 'uint256'], [holder, amount.toString()]),
      { from: guardian }
    )
    assert.equal((await token.balanceOf(holder)).toString(), '0')
  })

  it('cannot initialize the implementation or reinitialize the upgraded proxy', async () => {
    await _lib.assertRevert(
      implementation.governanceBurn(holder, amount, { from: deployer }),
      'InitializableV2: Not initialized'
    )
    await _lib.assertRevert(
      implementation.contract.methods['initialize(address,address)'](
        deployer,
        governance.address
      ).call({ from: deployer }),
      'Only proxy admin can initialize'
    )
    await _lib.assertRevert(
      token.contract.methods['initialize(address,address)'](
        deployer,
        other
      ).call({ from: other }),
      'Only proxy admin can initialize'
    )
    await _lib.assertRevert(
      execute(
        'initialize(address,address)',
        ['address', 'address'],
        [deployer, governance.address]
      ),
      'Governance: Transaction failed.'
    )
    assert.deepEqual(await state(), before)
  })

  it('rejects calls through an uninitialized proxy and preserves the original implementation for rollback', async () => {
    const emptyProxy = await Proxy.new(
      implementation.address,
      governance.address,
      '0x',
      { from: deployer }
    )
    const emptyToken = await AudiusTokenV2.at(emptyProxy.address)
    await _lib.assertRevert(
      emptyToken.governanceBurn(holder, amount, { from: holder }),
      'InitializableV2: Not initialized'
    )
    const original = await AudiusToken.new({ from: deployer })
    await execute('upgradeTo(address)', ['address'], [original.address])
    const restored = await AudiusToken.at(token.address)
    assert.equal(
      (await restored.balanceOf(holder)).toString(),
      amount.toString()
    )
    await _lib.assertRevert(burn(holder), 'Governance: Transaction failed.')
  })
})
