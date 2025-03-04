import Decimal from 'decimal.js-light';
import {
  HttpException,
  TOKEN_NOT_SUPPORTED_ERROR_CODE,
  TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
  PRICE_FAILED_ERROR_CODE,
  PRICE_FAILED_ERROR_MESSAGE,
  TRADE_FAILED_ERROR_CODE,
  TRADE_FAILED_ERROR_MESSAGE,
  SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_CODE,
  SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_MESSAGE,
  SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_CODE,
  SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_MESSAGE,
  UNKNOWN_ERROR_ERROR_CODE,
  UNKNOWN_ERROR_MESSAGE,
} from '../../services/error-handler';
import { latency } from '../../services/base';
import { Multiversxish, XExchangeish } from '../../services/common-interfaces';
import { logger } from '../../services/logger';
import {
  PriceRequest,
  PriceResponse,
  TradeRequest,
  TradeResponse,
} from '../../amm/amm.requests';
import { ExpectedTrade } from './xexchange';
import { UserSigner } from '@multiversx/sdk-wallet/out';
import { TokenInfo } from '../../chains/multiversx/multiversx-base';
import BigNumber from 'bignumber.js';

export interface TradeInfo {
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  requestAmount: string;
  expectedTrade: ExpectedTrade;
}

export async function getTradeInfo(
  multiversxish: Multiversxish,
  xexchangeinsh: XExchangeish,
  baseAsset: string,
  quoteAsset: string,
  amount: string,
  tradeSide: string,
  allowedSlippage?: string
): Promise<TradeInfo> {
  const baseToken: TokenInfo = getFullTokenFromSymbol(multiversxish, baseAsset);
  const quoteToken: TokenInfo = getFullTokenFromSymbol(
    multiversxish,
    quoteAsset
  );

  const rawAmount = new BigNumber(amount).multipliedBy(
    10 ** baseToken.decimals
  );

  let expectedTrade: ExpectedTrade;
  if (tradeSide === 'BUY') {
    expectedTrade = await xexchangeinsh.estimateBuyTrade(
      quoteToken.identifier,
      baseToken.identifier,
      rawAmount,
      allowedSlippage
    );
  } else {
    expectedTrade = await xexchangeinsh.estimateSellTrade(
      baseToken.identifier,
      quoteToken.identifier,
      rawAmount,
      allowedSlippage
    );
  }

  return {
    baseToken: baseToken,
    quoteToken: quoteToken,
    requestAmount: rawAmount.toFixed(),
    expectedTrade: expectedTrade,
  };
}

export async function price(
  multiversxish: Multiversxish,
  xexchangeinsh: XExchangeish,
  req: PriceRequest
): Promise<PriceResponse> {
  const startTimestamp: number = Date.now();

  const baseToken: TokenInfo = getFullTokenFromSymbol(multiversxish, req.base);
  const quoteToken: TokenInfo = getFullTokenFromSymbol(
    multiversxish,
    req.quote
  );

  let price: string;
  try {
    price = await xexchangeinsh.getPrice(baseToken, quoteToken);
  } catch (e) {
    if (e instanceof Error) {
      throw new HttpException(
        500,
        PRICE_FAILED_ERROR_MESSAGE + e.message,
        PRICE_FAILED_ERROR_CODE
      );
    } else {
      throw new HttpException(
        500,
        UNKNOWN_ERROR_MESSAGE,
        UNKNOWN_ERROR_ERROR_CODE
      );
    }
  }

  const rawAmount = new BigNumber(req.amount).multipliedBy(
    10 ** baseToken.decimals
  );

  const gasPrice: number = multiversxish.gasPrice;
  const gasLimitTransaction: number = multiversxish.gasLimitTransaction;
  const expectedAmount: string = new BigNumber(price).toFixed();

  logger.info(
    JSON.stringify({
      network: multiversxish.chain,
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      side: req.side,
      base: req.base,
      quote: req.quote,
      amount: req.amount,
      rawAmount: rawAmount.toString(),
      expectedAmount: expectedAmount,
      price: price,
    })
  );

  return {
    network: multiversxish.chain,
    timestamp: startTimestamp,
    latency: latency(startTimestamp, Date.now()),
    base: req.base,
    quote: req.quote,
    amount: req.amount,
    rawAmount: rawAmount.toString(),
    expectedAmount: expectedAmount,
    price: price,
    gasPrice: gasPrice,
    gasPriceToken: multiversxish.nativeTokenSymbol,
    gasLimit: gasLimitTransaction,
    gasCost: '0.0004',
  };
}

export async function trade(
  multiversxish: Multiversxish,
  xexchangeinsh: XExchangeish,
  req: TradeRequest
): Promise<TradeResponse> {
  const startTimestamp: number = Date.now();

  const limitPrice = req.limitPrice;
  const account: UserSigner = await multiversxish.getWallet(req.address);

  let tradeInfo: TradeInfo;
  try {
    tradeInfo = await getTradeInfo(
      multiversxish,
      xexchangeinsh,
      req.base,
      req.quote,
      req.amount,
      req.side
    );
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Could not get trade info. ${e.message}`);
      throw new HttpException(
        500,
        TRADE_FAILED_ERROR_MESSAGE + e.message,
        TRADE_FAILED_ERROR_CODE
      );
    } else {
      logger.error('Unknown error trying to get trade info.');
      throw new HttpException(
        500,
        UNKNOWN_ERROR_MESSAGE,
        UNKNOWN_ERROR_ERROR_CODE
      );
    }
  }

  const gasPrice: number = multiversxish.gasPrice;
  const gasLimitTransaction: number = multiversxish.gasLimitTransaction;
  const gasLimitEstimate: number = xexchangeinsh.gasLimitEstimate;

  const expectedAmount: string = tradeInfo.expectedTrade.trade.inputAmount;

  let estimatedPrice: string;

  if (req.side === 'BUY') {
    estimatedPrice = new BigNumber(tradeInfo.expectedTrade.trade.inputAmount)
      .div(10 ** tradeInfo.quoteToken.decimals)
      .div(req.amount)
      .toFixed(tradeInfo.baseToken.decimals);
  } else {
    estimatedPrice = new BigNumber(tradeInfo.expectedTrade.trade.outputAmount)
      .div(10 ** tradeInfo.quoteToken.decimals)
      .div(req.amount)
      .toFixed(tradeInfo.baseToken.decimals);
  }

  logger.info(
    `Expected execution price is ${estimatedPrice}, ` +
      `limit price is ${limitPrice}.`
  );

  if (req.side === 'BUY') {
    if (limitPrice && new Decimal(estimatedPrice).gt(new Decimal(limitPrice))) {
      logger.error('Swap price exceeded limit price.');
      throw new HttpException(
        500,
        SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_MESSAGE(
          estimatedPrice,
          limitPrice
        ),
        SWAP_PRICE_EXCEEDS_LIMIT_PRICE_ERROR_CODE
      );
    }

    const tx = await xexchangeinsh.executeTrade(
      account,
      tradeInfo.expectedTrade,
      xexchangeinsh.gasLimitEstimate,
      req.allowedSlippage
    );
    console.log(tx.getData().toString());
    const signature = await account.sign(tx.serializeForSigning());
    tx.applySignature(signature);
    const txHash = await multiversxish.provider.sendTransaction(tx);

    logger.info(`Buy xExchange swap has been executed.`);

    return {
      network: multiversxish.chain,
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      base: tradeInfo.baseToken.symbol,
      quote: tradeInfo.quoteToken.symbol,
      amount: req.amount,
      rawAmount: tradeInfo.requestAmount.toString(),
      expectedIn: expectedAmount,
      price: estimatedPrice,
      gasPrice: gasPrice,
      gasPriceToken: multiversxish.nativeTokenSymbol,
      gasLimit: gasLimitTransaction,
      gasCost: String((gasPrice * gasLimitEstimate) / 1e24),
      txHash: txHash,
    };
  } else {
    if (limitPrice && new Decimal(estimatedPrice).lt(new Decimal(limitPrice))) {
      logger.error('Swap price lower than limit price.');
      throw new HttpException(
        500,
        SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_MESSAGE(
          estimatedPrice,
          limitPrice
        ),
        SWAP_PRICE_LOWER_THAN_LIMIT_PRICE_ERROR_CODE
      );
    }

    const tx = await xexchangeinsh.executeTrade(
      account,
      tradeInfo.expectedTrade,
      xexchangeinsh.gasLimitEstimate,
      req.allowedSlippage
    );
    console.log(tx.getData().toString());
    const signature = await account.sign(tx.serializeForSigning());
    tx.applySignature(signature);
    const txHash = await multiversxish.provider.sendTransaction(tx);

    logger.info(`Sell xExchange swap has been executed.`);

    return {
      network: multiversxish.chain,
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      base: tradeInfo.baseToken.symbol,
      quote: tradeInfo.quoteToken.symbol,
      amount: req.amount,
      rawAmount: tradeInfo.requestAmount.toString(),
      expectedOut: expectedAmount,
      price: estimatedPrice,
      gasPrice: gasPrice,
      gasPriceToken: multiversxish.nativeTokenSymbol,
      gasLimit: gasLimitTransaction,
      gasCost: String((gasPrice * gasLimitEstimate) / 1e24),
      txHash: txHash,
    };
  }
}

export function getFullTokenFromSymbol(
  multiversxish: Multiversxish,
  tokenSymbol: string
): TokenInfo {
  const tokenInfo: TokenInfo | undefined =
    multiversxish.getTokenBySymbol(tokenSymbol);

  if (!tokenInfo)
    throw new HttpException(
      500,
      TOKEN_NOT_SUPPORTED_ERROR_MESSAGE + tokenSymbol,
      TOKEN_NOT_SUPPORTED_ERROR_CODE
    );
  return tokenInfo;
}
