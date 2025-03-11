import NodeCache from 'node-cache';
import { TokenListType, TokenValue, walletPath } from '../../services/base';
import {
  ProxyNetworkProvider,
  TransactionOnNetwork,
} from '@multiversx/sdk-network-providers/out';
import { ReferenceCountingCloseable } from '../../services/refcounting-closeable';
import { EvmTxStorage } from '../ethereum/evm.tx-storage';
import path from 'path';
import { rootPath } from '../../paths';
import fse from 'fs-extra';
import { logger } from '../../services/logger';
import axios from 'axios';
import { promises as fs } from 'fs';
import { Account } from '@multiversx/sdk-core/out';
import { UserSecretKey, UserSigner } from '@multiversx/sdk-wallet/out';
import { ConfigManagerCertPassphrase } from '../../services/config-manager-cert-passphrase';
import { BigNumber } from 'ethers';
import { Encryptor, Randomness } from '@multiversx/sdk-wallet/out/crypto';

// information about a MultiversX token
export interface TokenInfo {
  chainId: string;
  name: string;
  symbol: string;
  identifier: string;
  decimals: number;
}

export class MultiversxBase {
  private _provider;
  protected tokenList: TokenInfo[] = [];
  private _tokenMap: Record<string, TokenInfo> = {};
  // there are async values set in the constructor
  private _ready: boolean = false;
  private _initialized: Promise<boolean> = Promise.resolve(false);
  public chainName;
  public chainId;
  public rpcUrl;
  public gasPriceConstant;
  private _gasLimitTransaction;
  public tokenListSource: string;
  public tokenListType: TokenListType;
  public cache: NodeCache;
  private readonly _refCountingHandle: string;
  // private readonly _nonceManager: EVMNonceManager;
  private readonly _txStorage: EvmTxStorage;

  constructor(
    chainName: string,
    chainId: string,
    rpcUrl: string,
    tokenListSource: string,
    tokenListType: TokenListType,
    gasPriceConstant: number,
    gasLimitTransaction: number,
    transactionDbPath: string,
  ) {
    this._provider = new ProxyNetworkProvider(rpcUrl);
    this.chainName = chainName;
    this.chainId = chainId;
    this.rpcUrl = rpcUrl;
    this.gasPriceConstant = gasPriceConstant;
    this.tokenListSource = tokenListSource;
    this.tokenListType = tokenListType;

    this._refCountingHandle = ReferenceCountingCloseable.createHandle();

    this.cache = new NodeCache({ stdTTL: 3600 }); // set default cache ttl to 1hr
    this._gasLimitTransaction = gasLimitTransaction;
    this._txStorage = EvmTxStorage.getInstance(
      this.resolveDBPath(transactionDbPath),
      this._refCountingHandle,
    );
    this._txStorage.declareOwnership(this._refCountingHandle);
  }

  ready(): boolean {
    return this._ready;
  }

  public get provider() {
    return this._provider;
  }

  public get gasLimitTransaction() {
    return this._gasLimitTransaction;
  }

  public resolveDBPath(oldPath: string): string {
    if (oldPath.charAt(0) === '/') return oldPath;
    const dbDir: string = path.join(rootPath(), 'db/');
    fse.mkdirSync(dbDir, { recursive: true });
    return path.join(dbDir, oldPath);
  }

  async init(): Promise<void> {
    await this._initialized; // Wait for any previous init() calls to complete
    if (!this.ready()) {
      // If we're not ready, this._initialized will be a Promise that resolves after init() completes
      this._initialized = (async () => {
        try {
          await this.loadTokens(this.tokenListSource, this.tokenListType);
          return true;
        } catch (e) {
          logger.error(`Failed to initialize ${this.chainName} chain: ${e}`);
          return false;
        }
      })();
      this._ready = await this._initialized; // Wait for the initialization to complete
    }
    return;
  }

  async loadTokens(
    tokenListSource: string,
    tokenListType: TokenListType,
  ): Promise<void> {
    this.tokenList = await this.getTokenList(tokenListSource, tokenListType);
    // Only keep tokens in the same chain
    this.tokenList = this.tokenList.filter(
      (token: TokenInfo) => token.chainId === this.chainId,
    );
    if (this.tokenList) {
      this.tokenList.forEach(
        (token: TokenInfo) => (this._tokenMap[token.symbol] = token),
      );
    }
  }

  // returns a Tokens for a given list source and list type
  async getTokenList(
    tokenListSource: string,
    tokenListType: TokenListType,
  ): Promise<TokenInfo[]> {
    let tokens: TokenInfo[];
    if (tokenListType === 'URL') {
      ({
        data: { tokens },
      } = await axios.get(tokenListSource));
    } else {
      tokens = JSON.parse(await fs.readFile(tokenListSource, 'utf8'));
    }

    return tokens;
  }

  public get txStorage(): EvmTxStorage {
    return this._txStorage;
  }

  // ethereum token lists are large. instead of reloading each time with
  // getTokenList, we can read the stored tokenList value from when the
  // object was initiated.
  public get storedTokenList(): TokenInfo[] {
    return Object.values(this._tokenMap);
  }

  // return the Token object for a symbol
  getTokenForSymbol(symbol: string): TokenInfo | null {
    return this._tokenMap[symbol] ? this._tokenMap[symbol] : null;
  }

  getWalletFromPrivateKey(privateKey: string): Account {
    const yourBufferOne = Buffer.from(privateKey, 'base64');
    const yourBufferTwo = Buffer.from(yourBufferOne.toString(), 'hex');
    const secretKey = new UserSecretKey(
      Uint8Array.from(yourBufferTwo.slice(0, 32)),
    );
    const signer = new UserSigner(secretKey);
    const account = new Account(signer.getAddress());
    return account;
  }

  // returns Wallet for an address
  // TODO: Abstract-away into base.ts
  async getWallet(address: string): Promise<UserSigner> {
    const path = `${walletPath}/${this.chainName}`;

    const encryptedPrivateKey: string = await fse.readFile(
      `${path}/${address}.json`,
      'utf8',
    );

    const passphrase = ConfigManagerCertPassphrase.readPassphrase();

    if (!passphrase) {
      throw new Error('missing passphrase');
    }
    return UserSigner.fromWallet(JSON.parse(encryptedPrivateKey), passphrase);
  }

  encrypt(privateKey: string, password: string): string {
    const randomness = new Randomness();

    const yourBufferOne = Buffer.from(privateKey, 'base64');
    const yourBufferTwo = Buffer.from(yourBufferOne.toString(), 'hex');
    const secretKey = new UserSecretKey(
      Uint8Array.from(yourBufferTwo.slice(0, 32)),
    );
    const publicKey = secretKey.generatePublicKey();
    const data = publicKey.valueOf();
    const encryptedData = Encryptor.encrypt(data, password, randomness);

    return encryptedData.ciphertext;
  }

  // async decrypt(
  //   encryptedPrivateKey: string,
  //   password: string
  // ): Promise<Account> {
  //   const wallet = await Wallet.fromEncryptedJson(
  //     encryptedPrivateKey,
  //     password
  //   );
  //   return wallet.connect(this._provider);
  // }

  // returns the Native balance, convert BigNumber to string
  async getNativeBalance(wallet: Account): Promise<TokenValue> {
    const account = await this._provider.getAccount(wallet.address);
    return { value: BigNumber.from(account.balance.toFixed()), decimals: 18 };
  }

  // returns the balance for an ESDT token
  async getESDTBalance(
    tokenSymbol: string,
    wallet: Account,
    decimals: number,
  ): Promise<TokenValue> {
    logger.info('Requesting balance for owner ' + wallet.address + '.');
    const token = this.getTokenBySymbol(tokenSymbol);
    if (!token) {
      throw new Error(`Token ${tokenSymbol} not found`);
    }

    const result = await this._provider.getFungibleTokenOfAccount(
      wallet.address,
      token?.identifier,
    );
    logger.info(
      `Raw balance of ${tokenSymbol} for ` +
        `${wallet.address}: ${result.balance.toFixed()}`,
    );
    return {
      value: BigNumber.from(result.balance.toFixed()),
      decimals: decimals,
    };
  }

  // returns an ethereum TransactionResponse for a txHash.
  async getTransaction(txHash: string): Promise<TransactionOnNetwork> {
    return this._provider.getTransaction(txHash);
  }

  // caches transaction receipt once they arrive
  cacheTransactionReceipt(tx: TransactionOnNetwork) {
    this.cache.set(tx.hash, tx); // transaction hash is used as cache key since it is unique enough
  }

  // returns an ethereum TransactionReceipt for a txHash if the transaction has been mined.
  async getTransactionReceipt(
    txHash: string,
  ): Promise<TransactionOnNetwork | null> {
    if (this.cache.keys().includes(txHash)) {
      // If it's in the cache, return the value in cache, whether it's null or not
      return this.cache.get(txHash) as TransactionOnNetwork;
    } else {
      // If it's not in the cache,
      const fetchedTxReceipt = await this._provider.getTransaction(txHash);

      this.cache.set(txHash, fetchedTxReceipt); // Cache the fetched receipt, whether it's null or not

      return fetchedTxReceipt;
    }
  }

  public getTokenBySymbol(tokenSymbol: string): TokenInfo | undefined {
    return this.tokenList.find(
      (token: TokenInfo) =>
        token.symbol.toUpperCase() === tokenSymbol.toUpperCase() &&
        token.chainId === this.chainId,
    );
  }

  // returns the current block number
  async getCurrentBlockNumber(): Promise<number> {
    return (await this._provider.getNetworkStatus()).CurrentRound;
  }

  async close() {
    // await this._nonceManager.close(this._refCountingHandle);
    await this._txStorage.close(this._refCountingHandle);
  }
}
