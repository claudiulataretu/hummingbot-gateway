import { UserSigner } from '@multiversx/sdk-core/out';
import { TradeType } from '@uniswap/sdk';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { Multiversx } from '#src/chains/multiversx/multiversx';
import { getMultiversxChainConfig } from '#src/chains/multiversx/multiversx.config';
import { UniswapAmmExecuteSwapRequest } from '#src/connectors/uniswap/schemas';
import { ExecuteSwapRequestType } from '#src/schemas/amm-schema';
import { SwapExecuteResponse, SwapExecuteResponseType } from '#src/schemas/router-schema';
import { logger } from '#src/services/logger';

import { ExpectedTrade, XExchange } from '../xexchange';

import { quoteAmmSwap } from './quoteSwap';

export async function executeAmmSwap(
  fastify: FastifyInstance,
  walletAddress: string,
  network: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct: number,
): Promise<SwapExecuteResponseType> {
  const multiversx = await Multiversx.getInstance(network);
  if (!multiversx.ready()) await multiversx.init();

  const xexchange = await XExchange.getInstance(network);
  const baseTokenInfo = xexchange.getTokenByName(baseToken);
  const quoteTokenInfo = xexchange.getTokenByName(quoteToken);
  const poolAddress = await xexchange.findDefaultPool(baseTokenInfo, quoteTokenInfo);

  // Get quote using the shared quote function
  const quote = await quoteAmmSwap(xexchange, baseTokenInfo, quoteTokenInfo, amount, side, slippagePct);

  logger.info(`Executing swap`);
  logger.info(`Pool address: ${poolAddress}`);
  logger.info(`Input token: ${quote.inputToken.name}`);
  logger.info(`Output token: ${quote.outputToken.name}`);
  logger.info(`Side: ${side}`);

  try {
    // Regular wallet flow
    let wallet: UserSigner;
    try {
      wallet = await multiversx.getWallet(walletAddress);
    } catch (err) {
      logger.error(`Failed to load wallet: ${err.message}`);
      throw fastify.httpErrors.internalServerError(`Failed to load wallet: ${err.message}`);
    }

    const trade: ExpectedTrade = {
      trade: {
        pairAddress: poolAddress,
        tradeType: side === 'SELL' ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
        inputToken: quote.inputToken.address,
        outputToken: quote.outputToken.address,
        inputAmount: quote.rawAmountIn,
        outputAmount: quote.rawAmountOut,
      },
      expectedAmount: side === 'SELL' ? quote.rawAmountOut : quote.rawAmountIn,
    };

    const tx = await xexchange.executeTrade(wallet, trade);
    const signature = await wallet.sign(tx.serializeForSigning());
    tx.applySignature(new Uint8Array(signature));

    const txHash = await multiversx.provider.sendTransaction(tx);

    // Calculate amounts using quote values
    const amountIn = quote.estimatedAmountIn;
    const amountOut = quote.estimatedAmountOut;

    // Calculate balance changes as numbers
    const baseTokenBalanceChange = side === 'BUY' ? amountOut : -amountIn;
    const quoteTokenBalanceChange = side === 'BUY' ? -amountIn : amountOut;

    // // Calculate gas fee (formatTokenAmount already returns a number)
    // const gasFee = formatTokenAmount(
    //   receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
    //   18, // ETH has 18 decimals
    // );

    // Determine token addresses for computed fields
    const tokenIn = quote.inputToken.name === 'WEGLD' ? 'EGLD' : quote.inputToken.name;
    const tokenOut = quote.outputToken.name === 'WEGLD' ? 'EGLD' : quote.outputToken.name;

    await new Promise((resolve) => setTimeout(resolve, 1000));
    let txData = await multiversx.getTransaction(txHash);

    if (!txData || txData.status.isPending()) {
      const MAX_RETRIES = 5;
      const RETRY_DELAY_MS = 6000;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        txData = await multiversx.getTransaction(txHash);
        if (txData && txData.status.isExecuted()) break;
        retryCount++;
      }

      if (!txData) {
        // tx not found after retries
        logger.info(`Transaction ${txHash} not found in mempool or does not exist after ${MAX_RETRIES} retries.`);
        return {
          signature: txHash,
          status: -1,
          data: {
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            fee: 0,
            baseTokenBalanceChange,
            quoteTokenBalanceChange,
          },
        };
      }
    }

    return {
      signature: txHash,
      status: txData.status.isSuccessful() ? 1 : -1, // CONFIRMED
      data: {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        fee: 0,
        baseTokenBalanceChange,
        quoteTokenBalanceChange,
      },
    };
  } catch (error) {
    logger.error(`Swap execution error: ${error.message}`);

    // Handle specific error cases
    if (error.message && error.message.includes('insufficient funds')) {
      throw fastify.httpErrors.badRequest(
        'Insufficient funds for transaction. Please ensure you have enough ETH to cover gas costs.',
      );
    }

    // Re-throw if already a fastify error
    if (error.statusCode) {
      throw error;
    }

    throw fastify.httpErrors.internalServerError(`Failed to execute swap: ${error.message}`);
  }
}

export const executeSwapRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: ExecuteSwapRequestType;
    Reply: SwapExecuteResponseType;
  }>(
    '/execute-swap',
    {
      schema: {
        description: 'Execute a swap on xExchange AMM using direct pair',
        tags: ['/connector/xexchange'],
        body: UniswapAmmExecuteSwapRequest,
        response: { 200: SwapExecuteResponse },
      },
    },
    async (request) => {
      try {
        const multiversxConfig = getMultiversxChainConfig();
        const {
          walletAddress = multiversxConfig.defaultWallet,
          network = multiversxConfig.defaultNetwork,
          amount,
          side = 'SELL',
          slippagePct = 1,
        } = request.body as typeof UniswapAmmExecuteSwapRequest._type;

        let { baseToken, quoteToken } = request.body as typeof UniswapAmmExecuteSwapRequest._type;

        baseToken = baseToken === 'EGLD' ? 'WEGLD' : baseToken;
        quoteToken = quoteToken === 'EGLD' ? 'WEGLD' : quoteToken;

        return await executeAmmSwap(
          fastify,
          walletAddress,
          network,
          baseToken,
          quoteToken || '', // Handle optional quoteToken
          amount,
          side as 'BUY' | 'SELL',
          slippagePct,
        );
      } catch (e) {
        if (e.statusCode) throw e;
        logger.error('Error executing swap:', e);
        throw fastify.httpErrors.internalServerError(e.message || 'Internal server error');
      }
    },
  );
};

export default executeSwapRoute;
