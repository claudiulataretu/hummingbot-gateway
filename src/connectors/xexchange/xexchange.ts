import { isFractionString } from '../../services/validators';
import { XExchangeConfig } from './xexchange.config';
import { logger } from '../../services/logger';
import { percentRegexp } from '../../services/config-manager-v2';
import { Multiversx } from '../../chains/multiversx/multiversx';
import { TradeType } from '@uniswap/sdk-core';
import {
  AbiRegistry,
  Address,
  BigUIntValue,
  Interaction,
  ResultsParser,
  SmartContract,
  TokenIdentifierValue,
  TokenTransfer,
  Transaction,
} from '@multiversx/sdk-core/out';
import { promises } from 'fs';
import BigNumber from 'bignumber.js';
import { TokenInfo } from '../../chains/multiversx/multiversx-base';
import { UserSigner } from '@multiversx/sdk-wallet/out';
import { BalanceRequest } from '../../chains/chain.requests';

export type ExpectedTrade = {
  trade: any;
  expectedAmount: string;
};

export class XExchange {
  private static _instances: { [name: string]: XExchange };
  private chain: Multiversx;
  private _router: SmartContract = new SmartContract();
  private _router_address: string;
  private _router_abi: string;
  private _pair_abi: string;
  private _gasLimitEstimate: number;
  private _maximumHops: number;
  private chainId;
  private tokenList: Record<string, TokenInfo> = {};
  private _ready: boolean = false;
  private _ttl: number;

  private constructor(network: string) {
    const config = XExchangeConfig.config;
    this.chain = null;
    this._maximumHops = config.maximumHops;
    this._gasLimitEstimate = config.gasLimitEstimate;
    this._router_abi = config.routerAbi;
    this._pair_abi = config.pairAbi;
    this._router_address = config.routerAddress(network);
    this._ttl = config.ttl;
  }

  balances?(_req: BalanceRequest): Promise<Record<string, string>> {
    throw new Error('Method not implemented.');
  }

  public static async getInstance(network: string): Promise<XExchange> {
    if (!XExchange._instances) {
      XExchange._instances = {};
    }
    if (!XExchange._instances[network]) {
      const instance = new XExchange(network);
      await instance.init(network);
      XExchange._instances[network] = instance;
    }
    return XExchange._instances[network];
  }

  public async init(network: string) {
    if (!this.chain) {
      this.chain = await Multiversx.getInstance(network);
    }
    this.chainId = this.chain.chainId;
    for (const token of this.chain.storedTokenList) {
      this.tokenList[token.symbol] = {
        chainId: this.chainId,
        name: token.name,
        symbol: token.symbol,
        identifier: token.identifier,
        decimals: token.decimals,
      };
    }
    const jsonContent: string = await promises.readFile(this._router_abi, {
      encoding: 'utf8',
    });
    const json = JSON.parse(jsonContent);
    this._router = new SmartContract({
      address: Address.fromString(this._router_address),
      abi: AbiRegistry.create(json),
    });

    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  /**
   * Router address.
   */
  public get router(): string {
    return this._router_address;
  }

  /**
   * Default gas limit used to estimate gasCost for swap transactions.
   */
  public get gasLimitEstimate(): number {
    return this._gasLimitEstimate;
  }

  /**
   * Default time-to-live for swap transactions, in seconds.
   */
  public get ttl(): number {
    return this._ttl;
  }

  /**
   * Default maximum number of hops for to go through for a swap transactions.
   */
  public get maximumHops(): number {
    return this._maximumHops;
  }

  /**
   * Gets the allowed slippage percent from the optional parameter or the value
   * in the configuration.
   *
   * @param allowedSlippageStr (Optional) should be of the form '1/10'.
   */
  public getAllowedSlippage(allowedSlippageStr?: string): number {
    if (allowedSlippageStr != null && isFractionString(allowedSlippageStr)) {
      const fractionSplit = allowedSlippageStr.split('/');
      return parseInt(fractionSplit[0]) / parseInt(fractionSplit[1]);
    }

    const allowedSlippage = XExchangeConfig.config.allowedSlippage;
    const nd = allowedSlippage.match(percentRegexp);
    if (nd) return parseInt(nd[1]) / parseInt(nd[2]);
    throw new Error(
      'Encountered a malformed percent string in the config for ALLOWED_SLIPPAGE.',
    );
  }

  async getPrice(baseToken: TokenInfo, quoteToken: TokenInfo): Promise<string> {
    let interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken.identifier),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken.identifier),
    ]);
    let queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );
    let result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );

    const pairAddress = result.firstValue?.valueOf();

    const pairContract = await this.getPairSmartContract(pairAddress.bech32());

    interaction = pairContract.methodsExplicit.getReserve([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken.identifier),
    ]);

    queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );

    result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );
    const baseReserves: BigNumber = result.firstValue?.valueOf();

    interaction = pairContract.methodsExplicit.getReserve([
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken.identifier),
    ]);

    queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );

    result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );
    const quoteReserves: BigNumber = result.firstValue?.valueOf();

    const price = quoteReserves
      .dividedBy(10 ** quoteToken.decimals)
      .dividedBy(baseReserves.dividedBy(10 ** baseToken.decimals));

    return price.toFixed(9);
  }

  /**
   * Given the amount of `baseToken` to put into a transaction, calculate the
   * amount of `quoteToken` that can be expected from the transaction.
   *
   * This is typically used for calculating token sell prices.
   *
   * @param baseToken Token input for the transaction
   * @param quoteToken Output from the transaction
   * @param amount Amount of `baseToken` to put into the transaction
   */
  async estimateSellTrade(
    baseToken: string,
    quoteToken: string,
    amount: BigNumber,
  ): Promise<ExpectedTrade> {
    logger.info(`Fetching trade data for ${baseToken}-${quoteToken}.`);
    let interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken),
    ]);
    let queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );
    let result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );

    const pairAddress = result.firstValue?.valueOf();
    const pairContract = await this.getPairSmartContract(pairAddress.bech32());
    interaction = pairContract.methodsExplicit.getAmountOut([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);
    queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );
    result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );

    const expectedAmount = result.firstValue?.valueOf().toFixed();
    const trade = {
      pairAddress,
      inputToken: baseToken,
      outputToken: quoteToken,
      inputAmount: amount.toFixed(),
      outputAmount: expectedAmount,
      tradeType: TradeType.EXACT_INPUT,
    };

    return { trade, expectedAmount };
  }

  /**
   * Given the amount of `baseToken` desired to acquire from a transaction,
   * calculate the amount of `quoteToken` needed for the transaction.
   *
   * This is typically used for calculating token buy prices.
   *
   * @param quoteToken Token input for the transaction
   * @param baseToken Token output from the transaction
   * @param amount Amount of `baseToken` desired from the transaction
   */
  async estimateBuyTrade(
    quoteToken: string,
    baseToken: string,
    amount: BigNumber,
  ): Promise<ExpectedTrade> {
    logger.info(
      `Fetching pair data for ${quoteToken}-${baseToken} with amount ${amount.toFixed()}.`,
    );

    let interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken),
    ]);
    let queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );
    let result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );

    const pairAddress = result.firstValue?.valueOf();
    const pairContract = await this.getPairSmartContract(pairAddress.bech32());

    interaction = pairContract.methodsExplicit.getAmountIn([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);

    queryResult = await this.chain.provider.queryContract(
      interaction.buildQuery(),
    );

    result = new ResultsParser().parseQueryResponse(
      queryResult,
      interaction.getEndpoint(),
    );

    const expectedAmount = result.firstValue?.valueOf().toFixed();
    const trade = {
      pairAddress,
      inputToken: quoteToken,
      outputToken: baseToken,
      inputAmount: expectedAmount,
      outputAmount: amount.toFixed(),
      tradeType: TradeType.EXACT_OUTPUT,
    };

    return { trade, expectedAmount };
  }

  /**
   * Given a wallet and a Uniswap trade, try to execute it on blockchain.
   *
   * @param wallet Wallet
   * @param trade Expected trade
   * @param gasPrice Base gas price, for pre-EIP1559 transactions
   * @param uniswapRouter Router smart contract address
   * @param ttl How long the swap is valid before expiry, in seconds
   * @param _abi Router contract ABI
   * @param gasLimit Gas limit
   * @param nonce (Optional) EVM transaction nonce
   * @param maxFeePerGas (Optional) Maximum total fee per gas you want to pay
   * @param maxPriorityFeePerGas (Optional) Maximum tip per gas you want to pay
   */
  async executeTrade(
    wallet: UserSigner,
    trade: ExpectedTrade,
    _gasLimit: number,
  ): Promise<Transaction> {
    const pairContract = await this.getPairSmartContract(
      trade.trade.pairAddress.bech32(),
    );
    let interaction: Interaction;
    if (trade.trade.tradeType === TradeType.EXACT_INPUT) {
      const tolerance = this.getAllowedSlippage();
      const amountOutMin = new BigNumber(1)
        .dividedBy(new BigNumber(1).plus(tolerance))
        .multipliedBy(trade.expectedAmount)
        .integerValue();

      interaction = pairContract.methodsExplicit
        .swapTokensFixedInput([
          TokenIdentifierValue.esdtTokenIdentifier(trade.trade.outputToken),
          new BigUIntValue(amountOutMin),
        ])
        .withSingleESDTTransfer(
          TokenTransfer.fungibleFromBigInteger(
            trade.trade.inputToken,
            new BigNumber(trade.trade.inputAmount),
          ),
        );
    } else {
      const inputAmount = new BigNumber(trade.expectedAmount)
        .multipliedBy(1.01)
        .integerValue();
      interaction = pairContract.methodsExplicit
        .swapTokensFixedOutput([
          TokenIdentifierValue.esdtTokenIdentifier(trade.trade.outputToken),
          new BigUIntValue(new BigNumber(trade.trade.outputAmount)),
        ])
        .withSingleESDTTransfer(
          TokenTransfer.fungibleFromBigInteger(
            trade.trade.inputToken,
            inputAmount,
          ),
        );
    }
    const account = await this.chain.provider.getAccount(wallet.getAddress());
    interaction
      .withGasLimit(30000000)
      .withChainID(this.chainId)
      .withSender(wallet.getAddress())
      .withNonce(account.nonce);
    const transaction = interaction.buildTransaction();

    return transaction;
  }

  private async getPairSmartContract(
    pairAddress: string,
  ): Promise<SmartContract> {
    const jsonContent: string = await promises.readFile(this._pair_abi, {
      encoding: 'utf8',
    });
    const json = JSON.parse(jsonContent);
    return new SmartContract({
      address: Address.fromString(pairAddress),
      abi: AbiRegistry.create(json),
    });
  }
}
