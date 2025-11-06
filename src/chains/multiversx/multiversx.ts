import {
  Address,
  ProxyNetworkProvider,
  TransactionOnNetwork,
  TransactionReceipt,
  UserSecretKey,
  UserSigner,
  UserWallet,
} from '@multiversx/sdk-core';
import { BigNumber } from 'ethers';
import fse from 'fs-extra';

import { TokenValue, tokenValueToString } from '#src/services/base';
import { ConfigManagerCertPassphrase } from '#src/services/config-manager-cert-passphrase';
import { TokenService } from '#src/services/token-service';
import { Token } from '#src/tokens/types';
import { walletPath } from '#src/wallet/utils';

import { logger } from '../../services/logger';

import { getMultiversxNetworkConfig } from './multiversx.config';

export class Multiversx {
  private static _instances: { [name: string]: Multiversx };
  public provider: ProxyNetworkProvider;
  public tokenList: Token[] = [];
  public tokenMap: Record<string, Token> = {};
  public network: string;
  public nativeTokenSymbol: string;
  public chainId: number;
  public rpcUrl: string;
  public swapProvider: string;
  public minGasPrice: number;
  private _initialized: boolean = false;

  // For backward compatibility
  public get chain(): string {
    return this.network;
  }

  private constructor(network: string) {
    const config = getMultiversxNetworkConfig(network);
    this.chainId = config.chainID;
    this.rpcUrl = config.nodeURL;
    this.swapProvider = config.swapProvider || '';
    this.provider = new ProxyNetworkProvider(this.rpcUrl);
    logger.info(`Initializing Multiversx connector for network: ${network}, nodeURL: ${this.rpcUrl}`);
    this.network = network;
    this.nativeTokenSymbol = config.nativeCurrencySymbol;
    this.minGasPrice = config.minGasPrice || 0.1; // Default to 0.1 GWEI if not specified
  }

  public static async getInstance(network: string): Promise<Multiversx> {
    if (!Multiversx._instances) {
      Multiversx._instances = {};
    }
    if (!Multiversx._instances[network]) {
      const instance = new Multiversx(network);
      await instance.init();
      Multiversx._instances[network] = instance;
    }
    return Multiversx._instances[network];
  }

  public static getConnectedInstances(): { [name: string]: Multiversx } {
    return Multiversx._instances;
  }

  /**
   * Check if the Multiversx instance is ready
   */
  public ready(): boolean {
    return this._initialized;
  }

  /**
   * Initialize the Multiversx connector
   */
  public async init(): Promise<void> {
    try {
      await this.loadTokens();
      this._initialized = true;
    } catch (e) {
      logger.error(`Failed to initialize Multiversx chain: ${e}`);
      throw e;
    }
  }

  /**
   * Load tokens from the token list source
   */
  public async loadTokens(): Promise<void> {
    logger.info(`Loading tokens for ${this.network} using TokenService`);
    try {
      // Use TokenService to load tokens
      const tokens = await TokenService.getInstance().loadTokenList('multiversx', this.network);

      // Convert to TokenInfo format with chainId and normalize addresses
      this.tokenList = tokens.map((token) => ({
        ...token,
        chainId: this.chainId,
      }));

      if (this.tokenList) {
        logger.info(`Loaded ${this.tokenList.length} tokens for ${this.network}`);
        // Build token map for faster lookups
        this.tokenList.forEach((token: Token) => (this.tokenMap[token.symbol] = token));
      }
    } catch (error) {
      logger.error(`Failed to load token list: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all tokens loaded from the token list
   */
  public get storedTokenList(): Token[] {
    return Object.values(this.tokenMap);
  }

  /**
   * Get token info by symbol or address
   */
  public getToken(tokenName: string): Token | undefined {
    // First try to find token by symbol
    const tokenByName = this.tokenList.find(
      (token: Token) => token.name.toUpperCase() === tokenName.toUpperCase() && token.chainId === this.chainId,
    );

    if (tokenByName) {
      return tokenByName;
    }

    return undefined;
  }

  /**
   * Get multiple tokens and return a map with symbols as keys
   * This helper function is used by routes like allowances and balances
   * @param tokens Array of token symbols or addresses
   * @returns Map of token symbol to TokenInfo for found tokens
   */
  public getTokensAsMap(tokens: string[]): Record<string, Token> {
    const tokenMap: Record<string, Token> = {};

    for (const nameOrAddress of tokens) {
      const tokenInfo = this.getToken(nameOrAddress);
      if (tokenInfo) {
        // Use the actual token symbol as the key, not the input which might be an address
        tokenMap[tokenInfo.name] = tokenInfo;
      }
    }

    return tokenMap;
  }

  /**
   * Validate Multiversx address format
   * @param address The address to validate
   * @returns The address if valid
   * @throws Error if the address is invalid
   */
  public static validateAddress(address: string): string {
    try {
      // Check if address can be parsed as a public key
      new Address(address);
      // Additional check for proper length
      if (address.length < 62 || address.length > 64) {
        throw new Error('Invalid address length');
      }

      return address;
    } catch (error) {
      throw new Error(`Invalid Multiversx address format: ${address}`);
    }
  }

  /**
   * Create a wallet from a private key
   */
  public getWalletFromPrivateKey(privateKey: string): UserSigner {
    const yourBufferOne = Buffer.from(privateKey, 'base64');
    const yourBufferTwo = Buffer.from(yourBufferOne.toString(), 'hex');
    const secretKey = new UserSecretKey(Uint8Array.from(yourBufferTwo.slice(0, 32)));
    const signer = new UserSigner(secretKey);

    return signer;
  }

  public async getWallet(address: string): Promise<UserSigner> {
    try {
      // Validate the address format first
      const validatedAddress = Multiversx.validateAddress(address);

      const path = `${walletPath}/multiversx`;
      const encryptedPrivateKey = await fse.readFile(`${path}/${validatedAddress}.json`, 'utf8');

      const passphrase = ConfigManagerCertPassphrase.readPassphrase();
      if (!passphrase) {
        throw new Error('Missing passphrase');
      }
      return this.decrypt(encryptedPrivateKey, passphrase);
    } catch (error) {
      if (error.message.includes('Invalid Multiversx address')) {
        throw error; // Re-throw validation errors
      }
      if (error.code === 'ENOENT') {
        throw new Error(`Wallet not found for address: ${address}`);
      }
      throw error;
    }
  }

  /**
   * Encrypt a private key
   */
  public encrypt(privateKey: string, password: string): string {
    try {
      logger.info('Encrypting Multiversx wallet');
      const yourBufferOne = Buffer.from(privateKey, 'base64');
      const yourBufferTwo = Buffer.from(yourBufferOne.toString(), 'hex');
      const secretKey = new UserSecretKey(Uint8Array.from(yourBufferTwo.slice(0, 32)));
      const wallet = UserWallet.fromSecretKey({
        secretKey,
        password,
      });
      logger.info(`Encrypted Multiversx wallet: ${JSON.stringify(wallet.toJSON())}`);
      return JSON.stringify(wallet.toJSON());
    } catch (error) {
      throw new Error(`Invalid privateKey`, error);
    }
  }

  /**
   * Decrypt an encrypted private key
   */
  public decrypt(encryptedPrivateKey: string, password: string): UserSigner {
    return UserSigner.fromWallet(JSON.parse(encryptedPrivateKey), password);
  }

  /**
   * Get native token balance
   */
  public async getNativeBalance(wallet: UserSigner): Promise<TokenValue> {
    const account = await this.provider.getAccount(wallet.getAddress());
    return { value: BigNumber.from(account.balance.toFixed()), decimals: 18 };
  }

  /**
   * Get native token balance by address
   */
  public async getNativeBalanceByAddress(address: string): Promise<TokenValue> {
    const account = await this.provider.getAccount(Address.newFromBech32(address));
    return { value: BigNumber.from(account.balance.toFixed()), decimals: 18 };
  }

  async getESDTBalance(address: string, tokenName: string): Promise<TokenValue> {
    logger.info('Requesting balance for owner ' + address + '.');

    const token = this.getToken(tokenName);
    if (!token) {
      throw new Error(`Token ${tokenName} not found`);
    }

    const result = await this.provider.getFungibleTokenOfAccount(Address.fromBech32(address), token?.address);
    logger.info(`Raw balance of ${tokenName} for ` + `${address}: ${result.balance.toFixed()}`);
    return {
      value: BigNumber.from(result.balance.toFixed()),
      decimals: token.decimals,
    };
  }

  /**
   * Get all token balances for an address
   * @param address Wallet address
   * @param tokens Optional array of token symbols/addresses to fetch. If not provided, fetches all tokens in token list
   * @returns Map of token symbol to balance
   */
  public async getBalances(address: string, tokens?: string[]): Promise<Record<string, number>> {
    const balances: Record<string, number> = {};

    // Treat empty array as if no tokens were specified
    const effectiveTokens = tokens && tokens.length === 0 ? undefined : tokens;

    // Always get native token balance
    const nativeBalance = await this.getNativeBalanceByAddress(address);
    balances[this.nativeTokenSymbol] = parseFloat(tokenValueToString(nativeBalance));

    if (!effectiveTokens) {
      // No tokens specified, check all tokens in token list
      await this.getAllTokenBalances(address, balances);
    } else {
      // Get specific token balances
      await this.getSpecificTokenBalances(address, effectiveTokens, balances);
    }

    return balances;
  }

  private async getAllTokenBalances(address: string, balances: Record<string, number>): Promise<void> {
    logger.info(`Checking balances for all ${this.storedTokenList.length} tokens in the token list`);

    for (const token of this.storedTokenList.values()) {
      const tokenValue = await this.getESDTBalance(address, token.name);
      balances[token.name] = parseFloat(tokenValueToString(tokenValue));
    }
  }

  private async getSpecificTokenBalances(
    address: string,
    effectiveTokens: string[],
    balances: Record<string, number>,
  ): Promise<void> {
    logger.info(`Checking balances for all ${effectiveTokens.toString()} tokens in the token list`);

    for (const tokenName of effectiveTokens) {
      if (tokenName === this.nativeTokenSymbol) {
        continue;
      }

      const tokenValue = await this.getESDTBalance(address, tokenName);
      balances[tokenName] = parseFloat(tokenValueToString(tokenValue));
    }
  }

  /**
   * Get transaction details
   */
  public async getTransaction(txHash: string): Promise<TransactionOnNetwork> {
    return this.provider.getTransaction(txHash);
  }

  /**
   * Get transaction receipt directly
   */
  public async getTransactionReceipt(txHash: string): Promise<TransactionReceipt> {
    const transaction = await this.provider.getTransaction(txHash);
    return transaction.receipt;
  }

  /**
   * Get current block number
   */
  public async getCurrentBlockNumber(): Promise<number> {
    return (await this.provider.getNetworkStatus()).CurrentRound;
  }

  /**
   * Close the Multiversx connector and clean up resources
   */
  public async close() {
    if (this.network in Multiversx._instances) {
      delete Multiversx._instances[this.network];
    }
  }
}
