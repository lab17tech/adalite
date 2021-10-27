import AddressManager from './address-manager'
import {DEFAULT_TTL_SLOTS} from './constants'
import {
  AddressToPathMapper,
  AddressToPathMapping,
  AddressWithMeta,
  CryptoProvider,
  Lovelace,
  SendAmount,
  StakingHistoryObject,
  TxPlanArgs,
  TxType,
  Address,
  PoolOwnerTxPlanArgs,
  AssetFamily,
} from '../types'
import {
  getAccountXpub as getAccoutXpubShelley,
  ShelleyStakingAccountProvider,
  ShelleyBaseAddressProvider,
  getStakingXpub,
} from './shelley/shelley-address-provider'

import {selectMinimalTxPlan, TxPlan, TxPlanResult} from './shelley/transaction'
import {MaxAmountCalculator} from './max-amount-calculator'
import {
  ByronAddressProvider,
  getAccountXpub as getAccoutXpubByron,
} from './byron/byron-address-provider'
import {bechAddressToHex, isBase, addressToHex} from './shelley/helpers/addresses'
import {ShelleyTxAux} from './shelley/shelley-transaction'
import blockchainExplorer from './blockchain-explorer'
import {TxAux} from './shelley/types'
import {UTxO, TxOutput, TxAuxiliaryData} from './types'
import {aggregateTokenBundles} from './helpers/tokenFormater'
import {StakepoolDataProvider} from '../helpers/dataProviders/types'
import {unsignedPoolTxToTxPlan} from './shelley/helpers/stakepoolRegistrationUtils'
import {InternalError, InternalErrorReason, UnexpectedError, UnexpectedErrorReason} from '../errors'
import assertUnreachable from '../helpers/assertUnreachable'

const DummyAddressManager = () => {
  return {
    discoverAddresses: (): Promise<Address[]> => Promise.resolve([]),
    discoverAddressesWithMeta: (): Promise<AddressWithMeta[]> => Promise.resolve([]),
    getAddressToAbsPathMapping: (): AddressToPathMapping => ({}),
    _deriveAddress: (): Promise<Address> => Promise.resolve(null),
  }
}

export default DummyAddressManager

type MyAddressesParams = {
  accountIndex: number
  cryptoProvider: CryptoProvider
  gapLimit: number
  blockchainExplorer: ReturnType<typeof blockchainExplorer>
}

const MyAddresses = ({
  accountIndex,
  cryptoProvider,
  gapLimit,
  blockchainExplorer,
}: MyAddressesParams) => {
  const legacyExtManager =
    accountIndex === 0
      ? AddressManager({
        addressProvider: ByronAddressProvider(cryptoProvider, accountIndex, false),
        gapLimit,
        blockchainExplorer,
      })
      : DummyAddressManager()

  const legacyIntManager =
    accountIndex === 0
      ? AddressManager({
        addressProvider: ByronAddressProvider(cryptoProvider, accountIndex, true),
        gapLimit,
        blockchainExplorer,
      })
      : DummyAddressManager()

  const accountAddrManager = AddressManager({
    addressProvider: ShelleyStakingAccountProvider(cryptoProvider, accountIndex),
    gapLimit: 1,
    blockchainExplorer,
  })

  const baseExtAddrManager = AddressManager({
    addressProvider: ShelleyBaseAddressProvider(cryptoProvider, accountIndex, false),
    gapLimit,
    blockchainExplorer,
  })

  const baseIntAddrManager = AddressManager({
    addressProvider: ShelleyBaseAddressProvider(cryptoProvider, accountIndex, true),
    gapLimit,
    blockchainExplorer,
  })

  async function discoverAllAddresses() {
    const baseInt = await baseIntAddrManager.discoverAddresses()
    const baseExt = await baseExtAddrManager.discoverAddresses()
    const legacyInt = await legacyIntManager.discoverAddresses()
    const legacyExt = await legacyExtManager.discoverAddresses()
    const accountAddr = await accountAddrManager._deriveAddress(accountIndex)

    const isV1scheme = cryptoProvider.getDerivationScheme().type === 'v1'
    return {
      legacy: isV1scheme ? [...legacyExt] : [...legacyInt, ...legacyExt],
      base: [...baseInt, ...baseExt],
      account: accountAddr,
    }
  }

  function getAddressToAbsPathMapper() {
    const mapping = Object.assign(
      {},
      legacyIntManager.getAddressToAbsPathMapping(),
      legacyExtManager.getAddressToAbsPathMapping(),
      baseIntAddrManager.getAddressToAbsPathMapping(),
      baseExtAddrManager.getAddressToAbsPathMapping(),
      accountAddrManager.getAddressToAbsPathMapping()
    )
    return (address) => mapping[address]
  }

  function fixedPathMapper(): AddressToPathMapper {
    const mappingLegacy = {
      ...legacyIntManager.getAddressToAbsPathMapping(),
      ...legacyExtManager.getAddressToAbsPathMapping(),
    }
    const mappingShelley = {
      ...baseIntAddrManager.getAddressToAbsPathMapping(),
      ...baseExtAddrManager.getAddressToAbsPathMapping(),
      ...accountAddrManager.getAddressToAbsPathMapping(),
    }

    const fixedShelley = {}
    for (const key in mappingShelley) {
      fixedShelley[bechAddressToHex(key)] = mappingShelley[key]
    }
    return (address: Address) => {
      return mappingLegacy[address] || fixedShelley[address] || mappingShelley[address]
    }
  }

  async function areAddressesUsed(): Promise<boolean> {
    // we check only the external addresses since internal should not be used before external
    // https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit
    const baseExt = await baseExtAddrManager._deriveAddresses(0, gapLimit)
    return await blockchainExplorer.isSomeAddressUsed(baseExt)
  }

  async function getStakingAddress() {
    return await accountAddrManager._deriveAddress(accountIndex)
  }

  return {
    getAddressToAbsPathMapper,
    fixedPathMapper,
    discoverAllAddresses,
    // TODO(refactor)
    baseExtAddrManager,
    accountAddrManager,
    legacyExtManager,
    areAddressesUsed,
    getStakingAddress,
  }
}

type AccountParams = {
  config: any
  cryptoProvider: CryptoProvider
  blockchainExplorer: ReturnType<typeof blockchainExplorer>
  accountIndex: number
}

const Account = ({config, cryptoProvider, blockchainExplorer, accountIndex}: AccountParams) => {
  const {getMaxSendableAmount: _getMaxSendableAmount} = MaxAmountCalculator()

  const myAddresses = MyAddresses({
    accountIndex,
    cryptoProvider,
    gapLimit: config.ADALITE_GAP_LIMIT,
    blockchainExplorer,
  })

  let isLoaded = false
  let utxos: Array<UTxO> | null = null

  // must be called before using other methods of the account object
  async function loadCurrentState(validStakepoolDataProvider: StakepoolDataProvider) {
    const [accountInfo, newUtxos] = await Promise.all([
      _fetchAccountInfo(validStakepoolDataProvider),
      _fetchUtxos(),
    ])
    utxos = newUtxos
    isLoaded = true
    return accountInfo
  }

  function _assertAccountLoaded() {
    if (!isLoaded) {
      throw new UnexpectedError(UnexpectedErrorReason.AccountNotLoaded)
    }
  }

  async function ensureXpubIsExported(): Promise<void> {
    // get first address to ensure that public key was exported
    await myAddresses.baseExtAddrManager._deriveAddress(0)
  }

  async function calculateTtl(): Promise<number> {
    // TODO: move to wallet
    try {
      const bestSlot = await blockchainExplorer.getBestSlot().then((res) => res.Right.bestSlot)
      return bestSlot + DEFAULT_TTL_SLOTS
    } catch (e) {
      const timePassed = Math.floor((Date.now() - cryptoProvider.network.eraStartDateTime) / 1000)
      return cryptoProvider.network.eraStartSlot + timePassed + DEFAULT_TTL_SLOTS
    }
  }

  function mapAuxiliaryData(auxiliaryData: TxAuxiliaryData): TxAuxiliaryData {
    if (!auxiliaryData) return null
    if (auxiliaryData.type === 'CATALYST_VOTING') {
      const rewardAddress = auxiliaryData.rewardDestinationAddress.address
      return {
        ...auxiliaryData,
        rewardDestinationAddress: {
          address: rewardAddress,
          stakingPath: myAddresses.getAddressToAbsPathMapper()(rewardAddress),
        },
      }
    } else {
      return assertUnreachable(auxiliaryData.type)
    }
  }

  async function prepareTxAux(txPlan: TxPlan, ttl?: number, validityIntervalStart?: number) {
    const {inputs, outputs, change, fee, certificates, withdrawals, auxiliaryData} = txPlan
    const stakingAddress = await myAddresses.getStakingAddress()
    const changeOutputs: TxOutput[] = change.map((output) => ({
      ...output,
      isChange: true,
      spendingPath: myAddresses.getAddressToAbsPathMapper()(output.address),
      stakingPath: myAddresses.getAddressToAbsPathMapper()(stakingAddress),
    }))
    const txTtl = ttl === undefined ? await calculateTtl() : ttl
    const txValidityIntervalStart = validityIntervalStart ?? null
    const mappedAuxiliaryData = mapAuxiliaryData(auxiliaryData)

    return ShelleyTxAux({
      inputs,
      outputs: [...outputs, ...changeOutputs],
      fee,
      ttl: txTtl,
      certificates,
      withdrawals,
      auxiliaryDataHash: '',
      auxiliaryData: mappedAuxiliaryData,
      validityIntervalStart: txValidityIntervalStart,
    })
  }

  async function signTxAux(txAux: TxAux) {
    const signedTx = await cryptoProvider
      .signTx(txAux, myAddresses.fixedPathMapper())
      .catch((e) => {
        throw new InternalError(InternalErrorReason.TransactionRejectedWhileSigning, {
          message: e.message,
        })
      })
    return signedTx
  }

  async function witnessPoolRegTxAux(txAux: TxAux) {
    const txWitness = await cryptoProvider
      .witnessPoolRegTx(txAux, myAddresses.fixedPathMapper())
      .catch((e) => {
        throw new InternalError(InternalErrorReason.TransactionRejectedWhileSigning, {
          message: e.message,
        })
      })
    return txWitness
  }

  function getMaxSendableAmount(address: Address, sendAmount: SendAmount, decimals: number = 0) {
    _assertAccountLoaded()
    return _getMaxSendableAmount(utxos, address, sendAmount, decimals)
  }

  function getMaxNonStakingAmount(address: Address, sendAmount: SendAmount) {
    _assertAccountLoaded()
    const filteredUtxos = utxos.filter(({address}) => !isBase(addressToHex(address)))
    return _getMaxSendableAmount(filteredUtxos, address, sendAmount)
  }

  const _arrangeUtxos = (utxos: UTxO[], txPlanArgs: TxPlanArgs): UTxO[] => {
    // utxos are sorted deterministically to prevent the scenario of two transactions
    // based on the same set of utxos with the same intent getting through (provided the
    // transaction planning itself is deterministic, which it is ATM), causing kind of
    // a "double spend" from user's perspective
    const sortedUtxos = utxos.sort((a, b) =>
      a.txHash === b.txHash ? a.outputIndex - b.outputIndex : a.txHash.localeCompare(b.txHash)
    )
    const nonStakingUtxos = sortedUtxos.filter(({address}) => !isBase(addressToHex(address)))
    const baseAddressUtxos = sortedUtxos.filter(({address}) => isBase(addressToHex(address)))
    const adaOnlyUtxos = baseAddressUtxos.filter(({tokenBundle}) => tokenBundle.length === 0)
    const tokenUtxos = baseAddressUtxos.filter(({tokenBundle}) => tokenBundle.length > 0)

    if (
      txPlanArgs.txType === TxType.SEND_ADA &&
      txPlanArgs.sendAmount.assetFamily === AssetFamily.TOKEN
    ) {
      const {policyId, assetName} = txPlanArgs.sendAmount.token
      const targetTokenUtxos = tokenUtxos.filter(({tokenBundle}) =>
        tokenBundle.some((token) => token.policyId === policyId && token.assetName === assetName)
      )
      const nonTargetTokenUtxos = tokenUtxos.filter(
        ({tokenBundle}) =>
          !tokenBundle.some((token) => token.policyId === policyId && token.assetName === assetName)
      )
      return [...targetTokenUtxos, ...nonStakingUtxos, ...adaOnlyUtxos, ...nonTargetTokenUtxos]
    }
    return [...nonStakingUtxos, ...adaOnlyUtxos, ...tokenUtxos]
  }

  /*
   * utxos being passed from outside is a tradeoff against encapsulation of the Account object
   * which should otherwise manage them internally
   *
   * TODO: refactor as suggested in https://github.com/vacuumlabs/adalite/issues/1181
   */
  const getTxPlan = async (txPlanArgs: TxPlanArgs): Promise<TxPlanResult> => {
    const changeAddress = await getChangeAddress()
    _assertAccountLoaded()
    const arrangedUtxos = _arrangeUtxos(utxos, txPlanArgs)
    return selectMinimalTxPlan(arrangedUtxos, changeAddress, txPlanArgs)
  }

  function isAccountUsed(): Promise<boolean> {
    //TODO: we should decouple shelley compatibility from usedness
    // in case the wallet is not shelley compatible we consider the
    // the first account not used
    return config.isShelleyCompatible && myAddresses.areAddressesUsed()
  }

  async function _fetchAccountInfo(validStakepoolDataProvider: StakepoolDataProvider) {
    const accountXpubs = await _getAccountXpubs()
    const stakingXpub = await getStakingXpub(cryptoProvider, accountIndex)
    const stakingAddress = await myAddresses.getStakingAddress()
    const {baseAddressBalance, nonStakingBalance, balance, tokenBalance} = await _fetchBalance()
    const shelleyAccountInfo = await _fetchStakingInfo(validStakepoolDataProvider)
    const stakingHistory = await _fetchStakingHistory(validStakepoolDataProvider)
    const visibleAddresses = await _fetchVisibleAddresses()
    const transactionHistory = await _fetchTxHistory()
    const poolRecommendation = await _fetchPoolRecommendation(
      shelleyAccountInfo.delegation,
      baseAddressBalance
    )
    const isUsed = await isAccountUsed()

    return {
      accountXpubs,
      stakingXpub,
      stakingAddress,
      balance,
      tokenBalance,
      shelleyBalances: {
        nonStakingBalance,
        stakingBalance: baseAddressBalance + shelleyAccountInfo.value,
        rewardsAccountBalance: shelleyAccountInfo.value,
      },
      shelleyAccountInfo,
      transactionHistory,
      stakingHistory,
      visibleAddresses,
      poolRecommendation,
      isUsed,
      accountIndex,
    }
  }

  async function _fetchBalance() {
    const {legacy, base} = await myAddresses.discoverAllAddresses()
    const {
      coins: nonStakingBalance,
      tokenBundle: nonStakingTokenBundle,
    } = await blockchainExplorer.getBalance(legacy)
    const {
      coins: baseAddressBalance,
      tokenBundle: stakingTokenBundle,
    } = await blockchainExplorer.getBalance(base)
    return {
      tokenBalance: aggregateTokenBundles([nonStakingTokenBundle, stakingTokenBundle]),
      baseAddressBalance,
      nonStakingBalance,
      balance: nonStakingBalance + baseAddressBalance,
    }
  }

  async function _fetchTxHistory(): Promise<any> {
    const {legacy, base, account} = await myAddresses.discoverAllAddresses()
    return blockchainExplorer.getTxHistory([...base, ...legacy, account])
  }

  async function _fetchStakingHistory(
    validStakepoolDataProvider: StakepoolDataProvider
  ): Promise<StakingHistoryObject[]> {
    const stakingAddress = await myAddresses.getStakingAddress()
    return blockchainExplorer.getStakingHistory(
      bechAddressToHex(stakingAddress),
      validStakepoolDataProvider
    )
  }

  async function _getAccountXpubs() {
    const shelleyAccountXpub = await getAccoutXpubShelley(cryptoProvider, accountIndex)
    const byronAccountXpub = await getAccoutXpubByron(cryptoProvider, accountIndex)
    return {
      shelleyAccountXpub,
      byronAccountXpub,
    }
  }

  async function _fetchStakingInfo(validStakepoolDataProvider: StakepoolDataProvider) {
    const stakingAddressHex = bechAddressToHex(await myAddresses.getStakingAddress())
    const {nextRewardDetails, ...accountInfo} = await blockchainExplorer.getStakingInfo(
      stakingAddressHex
    )
    const rewardDetails = await blockchainExplorer.getRewardDetails(
      nextRewardDetails,
      accountInfo.delegation.poolHash,
      validStakepoolDataProvider,
      cryptoProvider.network.epochsToRewardDistribution
    )

    return {
      ...accountInfo,
      rewardDetails,
      value: accountInfo.rewards ? parseInt(accountInfo.rewards, 10) : 0,
    }
  }

  async function getChangeAddress(): Promise<Address> {
    /*
     * We use visible addresses as change addresses to mainintain
     * AdaLite original functionality which did not consider change addresses.
     * This is an intermediate step between legacy mode and full Yoroi compatibility.
     */
    const candidates = await _fetchVisibleAddresses()

    const choice = candidates[0]
    return choice.address
  }

  async function _fetchUtxos(): Promise<Array<UTxO>> {
    const {legacy, base} = await myAddresses.discoverAllAddresses()
    return await blockchainExplorer.fetchUnspentTxOutputs([...legacy, ...base])
  }

  async function _fetchVisibleAddresses() {
    const addresses = config.isShelleyCompatible
      ? await myAddresses.baseExtAddrManager.discoverAddressesWithMeta()
      : await myAddresses.legacyExtManager.discoverAddressesWithMeta()
    return addresses
  }

  async function verifyAddress(addr: string) {
    if (!('displayAddressForPath' in cryptoProvider)) {
      throw new UnexpectedError(UnexpectedErrorReason.UnsupportedOperationError, {
        message: 'unsupported operation: verifyAddress',
      })
    }
    const absDerivationPath = myAddresses.getAddressToAbsPathMapper()(addr)
    const stakingAddress = await myAddresses.accountAddrManager._deriveAddress(accountIndex)
    const stakingPath = myAddresses.getAddressToAbsPathMapper()(stakingAddress)
    return await cryptoProvider.displayAddressForPath(absDerivationPath, stakingPath)
  }

  async function _fetchPoolRecommendation(pool: any, stakeAmount: Lovelace): Promise<any> {
    const poolHash = pool ? pool.poolHash : null
    const poolRecommendation = await blockchainExplorer.getPoolRecommendation(poolHash, stakeAmount)
    if (!poolRecommendation.recommendedPoolHash || config.ADALITE_ENFORCE_STAKEPOOL) {
      Object.assign(poolRecommendation, {
        recommendedPoolHash: config.ADALITE_STAKE_POOL_ID,
      })
    }
    const delegatesToRecommended = poolRecommendation.recommendedPoolHash === pool.poolHash
    return {
      ...poolRecommendation,
      shouldShowSaturatedBanner:
        !delegatesToRecommended && poolRecommendation.status === 'GivenPoolSaturated',
    }
  }

  async function getPoolRegistrationTxPlan(poolRegistrationArgs: PoolOwnerTxPlanArgs) {
    const stakingAddress = await myAddresses.getStakingAddress()
    return unsignedPoolTxToTxPlan(poolRegistrationArgs.unsignedTxParsed, stakingAddress)
  }

  return {
    signTxAux,
    witnessPoolRegTxAux,
    getChangeAddress,
    getMaxSendableAmount,
    getMaxNonStakingAmount,
    getTxPlan,
    prepareTxAux,
    verifyAddress,
    loadCurrentState,
    accountIndex,
    isAccountUsed,
    ensureXpubIsExported,
    _getAccountXpubs,
    getPoolRegistrationTxPlan,
    calculateTtl,
    _arrangeUtxos,
  }
}

export {Account}
