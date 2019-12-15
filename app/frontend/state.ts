import {ADALITE_CONFIG} from './config'

interface Transaction {}

type AuthMethodEnum = '' | 'hw-wallet' | 'mnemonic' // TODO

export interface State {
  loading: boolean
  loadingMessage: string
  alert: any // TODO
  displayWelcome: boolean
  currentTab: 'wallet-info'
  walletIsLoaded: boolean
  showStakingBanner: boolean
  newWalletMnemonic: string
  ownAddressesWithMeta: any // TODO
  sendAddress: any // TODO
  sendAmount: any // TODO

  sendTransactionSummary: {
    amount: number
    donation: number
    fee: number
  }

  router: {
    pathname: string
    hash: string
  }
  mnemonicAuthForm: {
    mnemonicInputValue: string
    mnemonicInputError: {code: string}
    formIsValid: boolean
  }

  authMethod: AuthMethodEnum
  showDemoWalletWarningDialog: boolean
  logoutNotificationOpen: boolean
  rawTransactionOpen: boolean
  rawTransaction: string
  showMnemonicInfoAlert: boolean
  transactionHistory: Array<Transaction>
  sendResponse: any // TODO
  checkedDonationType: string // TODO: enum
  showCustomDonationInput: boolean
  donationAmount: any // TODO
  maxDonationAmount: number
  percentageDonationValue: number
  percentageDonationText: string
  thresholdAmountReached: boolean
  highestAmountReached: number // TODO: why?
  emailSubmitSuccess: boolean
  emailSubmitMessage: string
  showUnexpectedErrorModal: boolean
  sendSentry: any //
  autoLogin: boolean

  // TODO
  waitingForHwWallet?: boolean
  showConfirmTransactionDialog?: boolean
  showTransactionErrorModal?: boolean
  showThanksForDonation?: boolean
  showContactFormModal?: boolean

  calculatingFee?: boolean

  userEmail?: string
  userComments?: string
  userName?: string

  sendAmountValidationError?: any
  showExportOption?: boolean

  conversionRates?: {data: {USD: number; EUR: number}}
  balance?: number
  showGenerateMnemonicDialog?: boolean

  walletLoadingError?: any
  showWalletLoadingErrorModal?: boolean
  usingHwWallet?: boolean
  addressVerificationError?: boolean
  showAddressDetail?: {address: string; bip32path: string; copyOnClick: boolean}
  hwWalletName?: string
  isDemoWallet?: boolean
  error?: any
  showAddressVerification?: boolean

  donationAmountValidationError?: any
  sendAddressValidationError?: any
  transactionSubmissionError?: any
}

const initialState: State = {
  loading: false,
  loadingMessage: '',
  alert: {
    show: false,
    type: 'success', // OPTIONS are error, warning, success
    title: 'Wrong mnemonic',
    hint: 'Hint: Ensure that your mnemonic is without mistake.',
  },
  displayWelcome:
    !(window.localStorage.getItem('dontShowDisclaimer') === 'true') &&
    ADALITE_CONFIG.ADALITE_DEVEL_AUTO_LOGIN !== 'true',
  currentTab: 'wallet-info',
  walletIsLoaded: false,
  showStakingBanner: !(window.localStorage.getItem('dontShowStakingBanner2') === 'true'),
  newWalletMnemonic: '',
  ownAddressesWithMeta: [],
  // todo - object (sub-state) from send-ada form
  sendAddress: {fieldValue: ''},
  sendAmount: {fieldValue: 0, coins: 0},
  sendTransactionSummary: {
    amount: 0,
    fee: 0,
    donation: 0,
  },
  router: {
    pathname: window.location.pathname,
    hash: window.location.hash,
  },
  mnemonicAuthForm: {
    mnemonicInputValue: '',
    mnemonicInputError: null,
    formIsValid: false,
  },
  authMethod: ['#trezor', '#hw-wallet'].includes(window.location.hash) ? 'hw-wallet' : '',
  showDemoWalletWarningDialog: false,
  logoutNotificationOpen: false,
  rawTransactionOpen: false,
  rawTransaction: '',
  showMnemonicInfoAlert: false,
  transactionHistory: [],
  sendResponse: {},
  checkedDonationType: '',
  showCustomDonationInput: false,
  donationAmount: {fieldValue: 0, coins: 0},
  maxDonationAmount: Infinity,
  percentageDonationValue: 0,
  percentageDonationText: '0.2%', // What is this and why it isn't in config?
  thresholdAmountReached: false,
  highestAmountReached: 0,
  emailSubmitSuccess: false,
  emailSubmitMessage: '',
  showUnexpectedErrorModal: false,
  sendSentry: {},
  autoLogin:
    ADALITE_CONFIG.ADALITE_ENV === 'local' && ADALITE_CONFIG.ADALITE_DEVEL_AUTO_LOGIN === 'true',
}

export {initialState}
