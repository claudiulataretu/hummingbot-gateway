import { BigNumber } from 'bignumber.js';
import { FastifyPluginAsync } from 'fastify';

import { formatTokenAmount } from '#src/connectors/uniswap/uniswap.utils';
import {
  QuoteSwapRequest,
  QuoteSwapRequestType,
  QuoteSwapResponse,
  QuoteSwapResponseType,
} from '#src/schemas/amm-schema';
import { logger } from '#src/services/logger';
import { sanitizeErrorMessage } from '#src/services/sanitize';
import { Token } from '#src/tokens/schemas';

import { ExpectedTrade, XExchange } from '../xexchange';

export async function quoteAmmSwap(
  xexchange: XExchange,
  baseToken: Token,
  quoteToken: Token,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct?: number,
): Promise<any> {
  try {
    // Determine which token is being traded (exact in/out)
    const exactIn = side === 'SELL';
    const [inputToken, outputToken] = exactIn ? [baseToken, quoteToken] : [quoteToken, baseToken];

    // Calculate slippage-adjusted amounts
    const slippageTolerance = slippagePct ?? xexchange.config.slippagePct;

    let minAmountOut, maxAmountIn, estimatedAmountIn, estimatedAmountOut, rawAmountIn, rawAmountOut;
    // Create the V2 trade
    let trade: ExpectedTrade;
    if (exactIn) {
      // For SELL (exactIn), we use the input amount and EXACT_INPUT trade type
      const amountBig = new BigNumber(amount).multipliedBy(`1e${inputToken.decimals}`);
      trade = await xexchange.estimateSellTrade(inputToken.address, outputToken.address, amountBig);
      minAmountOut = new BigNumber(trade.expectedAmount).multipliedBy(1 - slippageTolerance / 100).toFixed();
      maxAmountIn = amountBig;
      estimatedAmountIn = formatTokenAmount(amountBig.toFixed(), inputToken.decimals);
      estimatedAmountOut = formatTokenAmount(trade.expectedAmount, outputToken.decimals);
      rawAmountIn = amountBig.toFixed();
      rawAmountOut = trade.expectedAmount;
    } else {
      const amountBig = new BigNumber(amount).multipliedBy(`1e${outputToken.decimals}`);
      // For BUY (exactOut), we use the output amount and EXACT_OUTPUT trade type
      trade = await xexchange.estimateBuyTrade(inputToken.address, outputToken.address, amountBig);
      minAmountOut = amountBig;
      maxAmountIn = new BigNumber(trade.expectedAmount).multipliedBy(1 + slippageTolerance / 100);
      estimatedAmountIn = formatTokenAmount(trade.expectedAmount, inputToken.decimals);
      estimatedAmountOut = formatTokenAmount(amountBig.toFixed(), outputToken.decimals);
      rawAmountIn = trade.expectedAmount;
      rawAmountOut = amountBig.toFixed();
    }

    const minAmountOutValue = formatTokenAmount(minAmountOut, outputToken.decimals);
    const maxAmountInValue = formatTokenAmount(maxAmountIn, inputToken.decimals);

    return {
      poolAddress: trade.trade.pairAddress,
      estimatedAmountIn,
      estimatedAmountOut,
      minAmountOut: minAmountOutValue,
      maxAmountIn: maxAmountInValue,
      priceImpact: trade.trade.priceImpact,
      inputToken,
      outputToken,
      // Add raw values for execution
      rawAmountIn,
      rawAmountOut,
      rawMinAmountOut: minAmountOut,
      rawMaxAmountIn: maxAmountIn,
    };
  } catch (error) {
    logger.error(`Error quoting AMM swap: ${error.message}`);
    // Check for insufficient liquidity from the xExchange pair contract
    if (error.message?.includes('insufficient liquidity') || error.message?.includes('execution failed')) {
      throw new Error(`Insufficient liquidity in pool for ${baseToken.address}-${quoteToken.address}`);
    }
    throw error;
  }
}

async function formatSwapQuote(
  network: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct?: number,
): Promise<QuoteSwapResponseType> {
  logger.info(
    `formatSwapQuote: baseToken=${baseToken}, quoteToken=${quoteToken}, amount=${amount}, side=${side}, network=${network}`,
  );

  try {
    const xexchange = await XExchange.getInstance(network);
    const baseTokenInfo = xexchange.getTokenByName(baseToken);
    const quoteTokenInfo = xexchange.getTokenByName(quoteToken);
    // Use the extracted quote function
    const quote = await quoteAmmSwap(xexchange, baseTokenInfo, quoteTokenInfo, amount, side, slippagePct);

    logger.info(
      `Quote result: estimatedAmountIn=${quote.estimatedAmountIn}, estimatedAmountOut=${quote.estimatedAmountOut}`,
    );

    // Calculate balance changes based on which tokens are being swapped
    const baseTokenBalanceChange = side === 'BUY' ? quote.estimatedAmountOut : -quote.estimatedAmountIn;
    const quoteTokenBalanceChange = side === 'BUY' ? -quote.estimatedAmountIn : quote.estimatedAmountOut;

    logger.info(
      `Balance changes: baseTokenBalanceChange=${baseTokenBalanceChange}, quoteTokenBalanceChange=${quoteTokenBalanceChange}`,
    );

    // Calculate price based on side
    // For SELL: price = quote received / base sold
    // For BUY: price = quote needed / base received
    const price =
      side === 'SELL'
        ? quote.estimatedAmountOut / quote.estimatedAmountIn
        : quote.estimatedAmountIn / quote.estimatedAmountOut;

    // Calculate price impact percentage
    const priceImpactPct = quote.priceImpact;

    // Determine token addresses for computed fields
    const tokenIn = quote.inputToken.name === 'WEGLD' ? 'EGLD' : quote.inputToken.name;
    const tokenOut = quote.outputToken.name === 'WEGLD' ? 'EGLD' : quote.outputToken.name;

    return {
      // Base QuoteSwapResponse fields in correct order
      poolAddress: quote.poolAddress,
      tokenIn,
      tokenOut,
      amountIn: quote.estimatedAmountIn,
      amountOut: quote.estimatedAmountOut,
      price,
      slippagePct: slippagePct ?? 1, // Default 1% if not provided
      minAmountOut: quote.minAmountOut,
      maxAmountIn: quote.maxAmountIn,
      // AMM-specific fields
      priceImpactPct,
    };
  } catch (error) {
    logger.error(`Error formatting swap quote: ${error.message}`);
    if (error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
}

export const quoteSwapRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: QuoteSwapRequestType;
    Reply: QuoteSwapResponseType;
  }>(
    '/quote-swap',
    {
      schema: {
        description: 'Get swap quote for xExchange AMM',
        tags: ['/connector/xexchange'],
        querystring: {
          ...QuoteSwapRequest,
          properties: {
            ...QuoteSwapRequest.properties,
            network: { type: 'string', default: 'mainnet' },
            baseToken: { type: 'string', examples: ['WEGLD'] },
            quoteToken: { type: 'string', examples: ['USDC'] },
            amount: { type: 'number', examples: [0.001] },
            side: { type: 'string', enum: ['BUY', 'SELL'], examples: ['SELL'] },
            poolAddress: { type: 'string', examples: [''] },
            slippagePct: { type: 'number', examples: [1] },
          },
        },
        response: {
          200: QuoteSwapResponse,
        },
      },
    },
    async (request) => {
      try {
        const { network, amount, side, slippagePct } = request.query;
        let { baseToken, quoteToken } = request.query;
        const networkToUse = network;

        baseToken = baseToken === 'EGLD' ? 'WEGLD' : baseToken;
        quoteToken = quoteToken === 'EGLD' ? 'WEGLD' : quoteToken;

        // Validate essential parameters
        if (!baseToken || !quoteToken || !amount || !side) {
          throw fastify.httpErrors.badRequest('baseToken, quoteToken, amount, and side are required');
        }

        const xexchange = await XExchange.getInstance(networkToUse);
        const baseTokenInfo = xexchange.getTokenByName(baseToken);
        const quoteTokenInfo = xexchange.getTokenByName(quoteToken);

        // If poolAddress is not provided, look it up by token pair
        if (!baseTokenInfo || !quoteTokenInfo) {
          throw fastify.httpErrors.badRequest(
            sanitizeErrorMessage('Tokens not found: {}', !baseTokenInfo ? baseToken : quoteToken),
          );
        }

        const result = await formatSwapQuote(
          networkToUse,
          baseToken,
          quoteToken,
          amount,
          side as 'BUY' | 'SELL',
          slippagePct,
        );

        return result;
      } catch (e) {
        logger.error(e);
        if (e.statusCode) {
          throw e;
        }
        if (e.message?.includes('Pool not found')) {
          throw fastify.httpErrors.notFound(e.message);
        }
        if (e.message?.includes('Token not found')) {
          throw fastify.httpErrors.badRequest(e.message);
        }
        throw fastify.httpErrors.internalServerError('Internal server error');
      }
    },
  );
};

export default quoteSwapRoute;
