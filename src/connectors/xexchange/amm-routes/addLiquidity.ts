import { BigNumber } from 'bignumber.js';
import { FastifyPluginAsync } from 'fastify';

import { Multiversx } from '#src/chains/multiversx/multiversx';
import { getMultiversxChainConfig } from '#src/chains/multiversx/multiversx.config';
import { formatTokenAmount } from '#src/connectors/uniswap/uniswap.utils';
import {
  AddLiquidityRequest,
  AddLiquidityRequestType,
  AddLiquidityResponse,
  AddLiquidityResponseType,
} from '#src/schemas/amm-schema';
import { logger } from '#src/services/logger';

import { XExchange } from '../xexchange';

export async function executeAddLiquidity(
  fastify: any,
  walletAddress: string,
  network: string,
  poolAddress: string,
  baseTokenAmount: number,
  quoteTokenAmount: number,
  slippagePct: number,
): Promise<AddLiquidityResponseType> {
  const multiversx = await Multiversx.getInstance(network);
  if (!multiversx.ready()) await multiversx.init();

  const xexchange = await XExchange.getInstance(network);

  let wallet;
  try {
    wallet = await multiversx.getWallet(walletAddress);
  } catch (err) {
    logger.error(`Failed to load wallet: ${err.message}`);
    throw fastify.httpErrors.internalServerError(`Failed to load wallet: ${err.message}`);
  }

  try {
    const poolData = await xexchange.getPoolData(poolAddress);
    const firstDecimals = xexchange.getTokenByName(poolData.firstTokenId.split('-')[0])?.decimals ?? 18;
    const secondDecimals = xexchange.getTokenByName(poolData.secondTokenId.split('-')[0])?.decimals ?? 18;

    const baseRaw = new BigNumber(baseTokenAmount).multipliedBy(`1e${firstDecimals}`).integerValue();
    const quoteRaw = new BigNumber(quoteTokenAmount).multipliedBy(`1e${secondDecimals}`).integerValue();

    // Compute ratio-limited amounts based on pool reserves
    let firstActual: BigNumber;
    let secondActual: BigNumber;

    if (poolData.firstReserve.isZero() || poolData.secondReserve.isZero()) {
      // Empty pool — use provided amounts as-is
      firstActual = baseRaw;
      secondActual = quoteRaw;
    } else {
      const optimalSecond = baseRaw
        .multipliedBy(poolData.secondReserve)
        .dividedBy(poolData.firstReserve)
        .integerValue();
      if (optimalSecond.lte(quoteRaw)) {
        firstActual = baseRaw;
        secondActual = optimalSecond;
      } else {
        const optimalFirst = quoteRaw
          .multipliedBy(poolData.firstReserve)
          .dividedBy(poolData.secondReserve)
          .integerValue();
        firstActual = optimalFirst;
        secondActual = quoteRaw;
      }
    }

    const slippage = slippagePct / 100;
    const firstAmountMin = firstActual.multipliedBy(1 - slippage).integerValue();
    const secondAmountMin = secondActual.multipliedBy(1 - slippage).integerValue();

    const tx = await xexchange.buildAddLiquidityTx(
      wallet,
      poolAddress,
      poolData.firstTokenId,
      firstActual,
      poolData.secondTokenId,
      secondActual,
      firstAmountMin,
      secondAmountMin,
    );

    const signature = await wallet.sign(tx.serializeForSigning());
    tx.applySignature(new Uint8Array(signature));
    const txHash = await multiversx.provider.sendTransaction(tx);

    logger.info(`Add liquidity tx submitted: ${txHash}`);

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
        logger.info(`Transaction ${txHash} not found after retries.`);
        return {
          signature: txHash,
          status: -1,
          data: {
            fee: 0,
            baseTokenAmountAdded: formatTokenAmount(firstActual.toFixed(), firstDecimals),
            quoteTokenAmountAdded: formatTokenAmount(secondActual.toFixed(), secondDecimals),
          },
        };
      }
    }

    return {
      signature: txHash,
      status: txData.status.isSuccessful() ? 1 : -1,
      data: {
        fee: 0,
        baseTokenAmountAdded: formatTokenAmount(firstActual.toFixed(), firstDecimals),
        quoteTokenAmountAdded: formatTokenAmount(secondActual.toFixed(), secondDecimals),
      },
    };
  } catch (error) {
    logger.error(`Add liquidity error: ${error.message}`);
    if (error.message?.includes('insufficient funds')) {
      throw fastify.httpErrors.badRequest('Insufficient funds for transaction.');
    }
    if (error.statusCode) throw error;
    throw fastify.httpErrors.internalServerError(`Failed to add liquidity: ${error.message}`);
  }
}

export const addLiquidityRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: AddLiquidityRequestType;
    Reply: AddLiquidityResponseType;
  }>(
    '/add-liquidity',
    {
      schema: {
        description: 'Add liquidity to an xExchange AMM pair',
        tags: ['/connector/xexchange'],
        body: AddLiquidityRequest,
        response: { 200: AddLiquidityResponse },
      },
    },
    async (request) => {
      const multiversxConfig = getMultiversxChainConfig();
      const {
        walletAddress = multiversxConfig.defaultWallet,
        network = multiversxConfig.defaultNetwork,
        poolAddress,
        baseTokenAmount,
        quoteTokenAmount,
        slippagePct = 1,
      } = request.body as AddLiquidityRequestType;

      return executeAddLiquidity(
        fastify,
        walletAddress,
        network,
        poolAddress,
        baseTokenAmount,
        quoteTokenAmount,
        slippagePct,
      );
    },
  );
};

export default addLiquidityRoute;
