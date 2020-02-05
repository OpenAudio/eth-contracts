const fs = require('fs-extra')
const path = require('path')
const os = require('os')

const AudiusToken = artifacts.require('AudiusToken')
const Registry = artifacts.require('Registry')

const AudiusIdentityService = 'identity-service'
const AudiusContentService = 'content-service'
const AudiusCreatorNode = 'creator-node'

const Libs = 'libs'

const getDefaultAccount = async () => {
  let accounts = await web3.eth.getAccounts()
  return accounts[0]
}

/**  dirName is directory name of the audius repo that you're trying to get the path to */
const getDirectoryRoot = (dirName) => {
  const dir = path.join(__dirname, '../../')
  const traversePath = path.join(dir, dirName)

  if (!fs.existsSync(traversePath)) {
    throw new Error(`Couldn't find expected path ${traversePath}`)
  }
  return traversePath
}

/** Copies the contents of build/contracts to the outputDirPath */
const copyBuildDirectory = async (outputDirPath) => {
  const dir = path.join(__dirname, '..')
  const localTarget = path.join(dir, 'build/contracts')

  await createDir(outputDirPath)

  // clean up unnecessary metadata and copy ABI
  const files = fs.readdirSync(localTarget)
  files.forEach(function (file, index) {
    const filePath = path.join(localTarget, file)
    const fileObj = require(filePath)
    const newAbi = {
      contractName: fileObj.contractName,
      abi: fileObj.abi
    }
    fs.writeFileSync(
      path.join(outputDirPath, file),
      JSON.stringify(newAbi, null, 2),
      'utf-8'
    )
  })
}

/** Creates directory if path does not exist */
async function createDir (dir) {
  try {
    await fs.ensureDir(dir)
  } catch (err) {
    console.log(`Error with creating folder at path ${dir}: ${err}`)
  }
}

/**
 * Create config file in outputFilePath
 * config file contains deployed AudiusToken and Registry contract addresses, and ownerWallet
 */
const outputJsonConfigFile = async (outputFilePath) => {
  try {
    const audiusToken = await AudiusToken.deployed()
    const registry = await Registry.deployed()
    let outputDictionary = {}
    outputDictionary['audiusTokenAddress'] = audiusToken.address
    outputDictionary['registryAddress'] = registry.address
    outputDictionary['ownerWallet'] = await getDefaultAccount()
    outputDictionary['allWallets'] = await web3.eth.getAccounts()

    fs.writeFile(outputFilePath, JSON.stringify(outputDictionary), (err) => {
      if (err != null) {
        console.log(err)
      }
    })
    console.log(outputDictionary)
  } catch (e) {
    console.log(e)
  }
}

/** Replace eth-contracts artifacts in libs with new ABIs and config */
module.exports = async callback => {
  const libsDirRoot = path.join(getDirectoryRoot(Libs), 'eth-contracts')
  fs.removeSync(libsDirRoot)

  await copyBuildDirectory(path.join(libsDirRoot, '/ABIs'))
  outputJsonConfigFile(path.join(libsDirRoot, '/config.json'))

  // output to Identity Service
  try {
    outputJsonConfigFile(path.join(getDirectoryRoot(AudiusIdentityService), '/eth-contract-config.json'))
  } catch (e) {
    console.log("Identity service doesn't exist, probably running via E2E setup scripts", e)
  }

  // output to Creator Node
  try {
    outputJsonConfigFile(path.join(getDirectoryRoot(AudiusCreatorNode), '/eth-contract-config.json'))
  } catch (e) {
    console.log("Creator node doesn't exist, probably running via E2E setup scripts", e)
  }

  // special case for content service which isn't run locally for E2E test or during front end dev
  try {
    outputJsonConfigFile(path.join(getDirectoryRoot(AudiusContentService), '/eth-contract-config.json'))
  } catch (e) {
    console.log("Content service folder doesn't exist, probably running via E2E setup scripts", e)
  }

  const dappOutput = path.join(os.homedir(), '/.audius')
  if (!fs.existsSync(dappOutput)) {
    fs.mkdirSync(dappOutput, { recursive: true })
  }
  outputJsonConfigFile(path.join(dappOutput, '/eth-config.json'))
}
