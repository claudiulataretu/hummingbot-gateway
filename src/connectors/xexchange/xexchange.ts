import { promises } from 'fs';

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
  UserSigner,
} from '@multiversx/sdk-core/out';
import { TradeType } from '@uniswap/sdk-core';
import { BigNumber } from 'bignumber.js';

import { Token } from '#src/tokens/types';

import { Multiversx } from '../../chains/multiversx/multiversx';
import { logger } from '../../services/logger';

import { XExchangeConfig } from './xexchange.config';
import { getxExchangeRouterAddress } from './xexchange.contracts';

export type ExpectedTrade = {
  trade: any;
  expectedAmount: string;
};

export class XExchange {
  private static _instances: { [name: string]: XExchange };
  private multiversx: Multiversx;

  // Configuration
  public config: XExchangeConfig.RootConfig;

  private _router: SmartContract = new SmartContract();
  private _router_address: string;
  private _pairAbi: AbiRegistry | null = null;

  private chainId: number;
  private _ready: boolean = false;

  // Network information
  private networkName: string;

  private constructor(network: string) {
    this.networkName = network;
    this.config = XExchangeConfig.config;
    this._router_address = getxExchangeRouterAddress(network);
  }

  public static async getInstance(network: string): Promise<XExchange> {
    if (XExchange._instances === undefined) {
      XExchange._instances = {};
    }

    if (!(network in XExchange._instances)) {
      XExchange._instances[network] = new XExchange(network);
      await XExchange._instances[network].init();
    }

    return XExchange._instances[network];
  }

  public async init() {
    this.multiversx = await Multiversx.getInstance(this.networkName);
    this.chainId = this.multiversx.chainId;

    const routerJson = JSON.parse(await promises.readFile(this.config.routerAbi, { encoding: 'utf8' }));
    this._router = new SmartContract({
      address: Address.fromBech32(this._router_address),
      abi: AbiRegistry.create(routerJson),
    });

    const pairJson = JSON.parse(await promises.readFile(this.config.pairAbi, { encoding: 'utf8' }));
    this._pairAbi = AbiRegistry.create(pairJson);

    // Ensure multiversx is initialized
    if (!this.multiversx.ready()) {
      await this.multiversx.init();
    }

    this._ready = true;
    logger.info(`xExchange connector initialized for network: ${this.networkName}`);
  }

  public ready(): boolean {
    return this._ready;
  }

  /**
   * Given a token's symbol, return the connector's native representation of the token.
   */
  public getTokenByName(tokenName: string): Token | null {
    // multiversx.getToken handles both symbol and name lookups
    return this.multiversx.getToken(tokenName);
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
    return this.config.gasLimitEstimate;
  }

  async findDefaultPool(baseToken: Token, quoteToken: Token): Promise<string> {
    const interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken.address),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken.address),
    ]);
    const queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    const result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const pairAddress = result.firstValue?.valueOf().toBech32();

    return pairAddress;
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
  async estimateSellTrade(baseToken: string, quoteToken: string, amount: BigNumber): Promise<ExpectedTrade> {
    logger.info(`Fetching trade data for ${baseToken}-${quoteToken}.`);
    let interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken),
    ]);
    let queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    let result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const pairAddress = result.firstValue?.valueOf().toBech32();
    const pairContract = this.getPairSmartContract(pairAddress);

    interaction = pairContract.methodsExplicit.getEquivalent([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);
    queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const initialPrice = result.firstValue?.valueOf().toFixed();

    interaction = pairContract.methodsExplicit.getAmountOut([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);
    queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const expectedAmount = result.firstValue?.valueOf().toFixed();
    const priceImpact = new BigNumber(expectedAmount).minus(initialPrice).dividedBy(initialPrice).multipliedBy(100);

    const trade = {
      pairAddress,
      inputToken: baseToken,
      outputToken: quoteToken,
      inputAmount: amount.toFixed(),
      outputAmount: expectedAmount,
      priceImpact: priceImpact.toFixed(4),
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
  async estimateBuyTrade(quoteToken: string, baseToken: string, amount: BigNumber): Promise<ExpectedTrade> {
    logger.info(`Fetching pair data for ${quoteToken}-${baseToken} with amount ${amount.toFixed()}.`);

    let interaction = this._router.methodsExplicit.getPair([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      TokenIdentifierValue.esdtTokenIdentifier(quoteToken),
    ]);
    let queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    let result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const pairAddress = result.firstValue?.valueOf().toBech32();
    const pairContract = this.getPairSmartContract(pairAddress);

    interaction = pairContract.methodsExplicit.getEquivalent([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);
    queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());
    result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const initialPrice = result.firstValue?.valueOf().toFixed();

    interaction = pairContract.methodsExplicit.getAmountIn([
      TokenIdentifierValue.esdtTokenIdentifier(baseToken),
      new BigUIntValue(amount),
    ]);

    queryResult = await this.multiversx.provider.queryContract(interaction.buildQuery());

    result = new ResultsParser().parseQueryResponse(queryResult, interaction.getEndpoint());

    const expectedAmount = result.firstValue?.valueOf().toFixed();
    const priceImpact = new BigNumber(expectedAmount).minus(initialPrice).dividedBy(initialPrice).multipliedBy(100);

    const trade = {
      pairAddress,
      inputToken: quoteToken,
      outputToken: baseToken,
      inputAmount: expectedAmount,
      outputAmount: amount.toFixed(),
      priceImpact: priceImpact.toFixed(4),
      tradeType: TradeType.EXACT_OUTPUT,
    };

    return { trade, expectedAmount };
  }

  /**
   * Given a wallet and a trade, build and return a signed-ready transaction for xExchange.
   *
   * @param wallet Signer wallet
   * @param trade Expected trade (from estimateSellTrade or estimateBuyTrade)
   */
  async executeTrade(wallet: UserSigner, trade: ExpectedTrade): Promise<Transaction> {
    const pairContract = this.getPairSmartContract(trade.trade.pairAddress);
    let interaction: Interaction;
    const tolerance = this.config.slippagePct / 100;

    if (trade.trade.tradeType === TradeType.EXACT_INPUT) {
      const amountOutMin = new BigNumber(trade.expectedAmount).multipliedBy(1 - tolerance).integerValue();

      interaction = pairContract.methodsExplicit
        .swapTokensFixedInput([
          TokenIdentifierValue.esdtTokenIdentifier(trade.trade.outputToken),
          new BigUIntValue(amountOutMin),
        ])
        .withSingleESDTTransfer(
          TokenTransfer.fungibleFromBigInteger(trade.trade.inputToken, new BigNumber(trade.trade.inputAmount)),
        );
    } else {
      const inputAmount = new BigNumber(trade.expectedAmount).multipliedBy(1 + tolerance).integerValue();
      interaction = pairContract.methodsExplicit
        .swapTokensFixedOutput([
          TokenIdentifierValue.esdtTokenIdentifier(trade.trade.outputToken),
          new BigUIntValue(new BigNumber(trade.trade.outputAmount)),
        ])
        .withSingleESDTTransfer(TokenTransfer.fungibleFromBigInteger(trade.trade.inputToken, inputAmount));
    }
    const account = await this.multiversx.provider.getAccount(wallet.getAddress());
    interaction
      .withGasLimit(this.config.gasLimitEstimate)
      .withChainID(this.chainId.toString())
      .withSender(wallet.getAddress())
      .withNonce(account.nonce);
    const transaction = interaction.buildTransaction();

    return transaction;
  }

  private getPairSmartContract(pairAddress: string): SmartContract {
    return new SmartContract({
      address: Address.newFromBech32(pairAddress),
      abi: this._pairAbi,
    });
  }
}
