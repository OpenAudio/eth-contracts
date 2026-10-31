// Test-only configuration: run existing protocol scenarios against the exact V2 runtime.
const assert = require('assert')
const path = require('path')
const config = require('../truffle-config.js')
const lib = require('../utils/lib.js')
const root = path.resolve(__dirname, '..')
const deployTokenFixture = lib.deployToken
const burnBeforeTests = process.env.AUDIO_TEST_BURN === '1'
let verifiedFixtures = 0

lib.deployToken = async (artifacts, ...args) => {
  assert.strictEqual(
    await web3.eth.getChainId(),
    1337,
    'Local test chain required'
  )
  const token = await deployTokenFixture(
    {
      require: (name) =>
        artifacts.require(name === 'AudiusToken' ? 'AudiusTokenV2' : name)
    },
    ...args
  )
  const proxy = await artifacts
    .require('AudiusAdminUpgradeabilityProxy')
    .at(token.address)
  assert.strictEqual(
    (await web3.eth.getCode(await proxy.implementation())).toLowerCase(),
    artifacts.require('AudiusTokenV2').deployedBytecode.toLowerCase(),
    'Fixture must execute the exact V2 runtime'
  )
  if (burnBeforeTests) {
    const target = '0xCe9d97EE40Aa605aC117c333B5397839cc3fE807'
    const amount = web3.utils.toBN('19651690000000000000000000')
    const supply = await token.totalSupply()
    // args: proxy admin, deployer, token owner, governance.
    await token.transfer(target, amount, { from: args[2] })
    await token.burnBinanceIncidentBalance({ from: args[0] })
    assert.strictEqual((await token.balanceOf(target)).toString(), '0')
    assert.strictEqual(
      (await token.totalSupply()).toString(),
      supply.sub(amount).toString()
    )
  }
  verifiedFixtures++
  return token
}

process.on('exit', () =>
  console.log(
    `Verified V2 runtime in ${verifiedFixtures} shared token fixtures; incident-size burn: ${burnBeforeTests}`
  )
)

module.exports = {
  ...config,
  working_directory: root,
  contracts_directory: path.join(root, 'contracts'),
  contracts_build_directory: path.join(root, 'build/contracts'),
  migrations_directory: path.join(root, 'migrations'),
  test_directory: path.join(root, 'test'),
  networks: {
    development: {
      ...config.networks.development,
      port: Number(
        process.env.AUDIO_TEST_PORT || config.networks.development.port
      )
    }
  },
  // Upgrade-specific tests require a V1 starting fixture and run under the normal config.
  mocha: {
    ...config.mocha,
    grep: 'AudiusTokenV2|freezes the incident balance with one voted upgrade',
    invert: true
  }
}
