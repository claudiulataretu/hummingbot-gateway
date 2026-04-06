import { BigNumber } from 'bignumber.js';
import { FastifyPluginAsync } from 'fastify';

import { Multiversx } from '#src/chains/multiversx/multiversx';
import { getMultiversxChainConfig } from '#src/chains/multiversx/multiversx.config';
import { formatTokenAmount } from '#src/connectors/uniswap/uniswap.utils';
import {
  RemoveLiquidityRequest,
  RemoveLiquidityRequestType,
  RemoveLiquidityResponse,
  RemoveLiquidityResponseType,
} from '#src/schemas/amm-schema';
import { logger } from '#src/services/logger';

import { XExchange } from '../xexchange';

export async function executeRemoveLiquidity(
  fastify: any,
  walletAddress: string,
  network: string,
  poolAddress: string,
  percentageToRemove: number,
  slippagePct: number,
): Promise<RemoveLiquidityResponseType> {
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

    const userLpBalance = await xexchange.getLpTokenBalance(walletAddress, poolData.lpTokenId);
    const lpAmount = userLpBalance.multipliedBy(percentageToRemove).dividedBy(100).integerValue();

    if (lpAmount.isZero()) {
      throw fastify.httpErrors.badRequest('No LP tokens to remove or percentage results in zero amount.');
    }

    // Expected token amounts proportional to pool share
    const firstExpected = poolData.firstReserve.multipliedBy(lpAmount).dividedBy(poolData.lpSupply).integerValue();
    const secondExpected = poolData.secondReserve.multipliedBy(lpAmount).dividedBy(poolData.lpSupply).integerValue();

    const slippage = slippagePct / 100;
    const firstAmountMin = firstExpected.multipliedBy(1 - slippage).integerValue();
    const secondAmountMin = secondExpected.multipliedBy(1 - slippage).integerValue();

    const tx = await xexchange.buildRemoveLiquidityTx(
      wallet,
      poolAddress,
      poolData.lpTokenId,
      lpAmount,
      firstAmountMin,
      secondAmountMin,
    );

    const signature = await wallet.sign(tx.serializeForSigning());
    tx.applySignature(new Uint8Array(signature));
    const txHash = await multiversx.provider.sendTransaction(tx);

    logger.info(`Remove liquidity tx submitted: ${txHash}`);

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
            baseTokenAmountRemoved: formatTokenAmount(firstExpected.toFixed(), firstDecimals),
            quoteTokenAmountRemoved: formatTokenAmount(secondExpected.toFixed(), secondDecimals),
          },
        };
      }
    }

    return {
      signature: txHash,
      status: txData.status.isSuccessful() ? 1 : -1,
      data: {
        fee: 0,
        baseTokenAmountRemoved: formatTokenAmount(firstExpected.toFixed(), firstDecimals),
        quoteTokenAmountRemoved: formatTokenAmount(secondExpected.toFixed(), secondDecimals),
      },
    };
  } catch (error) {
    logger.error(`Remove liquidity error: ${error.message}`);
    if (error.message?.includes('insufficient funds')) {
      throw fastify.httpErrors.badRequest('Insufficient funds for transaction.');
    }
    if (error.statusCode) throw error;
    throw fastify.httpErrors.internalServerError(`Failed to remove liquidity: ${error.message}`);
  }
}

export const removeLiquidityRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: RemoveLiquidityRequestType;
    Reply: RemoveLiquidityResponseType;
  }>(
    '/remove-liquidity',
    {
      schema: {
        description: 'Remove liquidity from an xExchange AMM pair',
        tags: ['/connector/xexchange'],
        body: RemoveLiquidityRequest,
        response: { 200: RemoveLiquidityResponse },
      },
    },
    async (request) => {
      const multiversxConfig = getMultiversxChainConfig();
      const {
        walletAddress = multiversxConfig.defaultWallet,
        network = multiversxConfig.defaultNetwork,
        poolAddress,
        percentageToRemove,
      } = request.body as RemoveLiquidityRequestType;

      const slippagePct = (request.body as any).slippagePct ?? 1;

      return executeRemoveLiquidity(fastify, walletAddress, network, poolAddress, percentageToRemove, slippagePct);
    },
  );
};

export default removeLiquidityRoute;
