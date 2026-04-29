import { FastifyPluginAsync } from 'fastify';

import { getMultiversxChainConfig } from '#src/chains/multiversx/multiversx.config';
import { formatTokenAmount } from '#src/connectors/uniswap/uniswap.utils';
import {
  GetPositionInfoRequest,
  GetPositionInfoRequestType,
  PositionInfo,
  PositionInfoSchema,
} from '#src/schemas/amm-schema';
import { logger } from '#src/services/logger';

import { XExchange } from '../xexchange';

export async function getPositionInfo(
  fastify: any,
  network: string,
  poolAddress: string,
  walletAddress: string,
): Promise<PositionInfo> {
  if (!poolAddress) {
    throw fastify.httpErrors.badRequest('Pool address is required');
  }
  if (!walletAddress) {
    throw fastify.httpErrors.badRequest('No wallet address provided and no default wallet found');
  }

  try {
    const xexchange = await XExchange.getInstance(network);
    const poolData = await xexchange.getPoolData(poolAddress);

    const firstDecimals = xexchange.getTokenByName(poolData.firstTokenId.split('-')[0])?.decimals ?? 18;
    const secondDecimals = xexchange.getTokenByName(poolData.secondTokenId.split('-')[0])?.decimals ?? 18;
    const lpDecimals = xexchange.getTokenByName(poolData.lpTokenId.split('-')[0])?.decimals ?? 18;

    const lpBalance = await xexchange.getLpTokenBalance(walletAddress, poolData.lpTokenId);

    // Early return: no position, OR empty pool (lpSupply == 0 is a MultiversX-specific guard
    // because LP is a separate ESDT token decoupled from the pair contract, unlike Uniswap V2).
    if (lpBalance.isZero() || poolData.lpSupply.isZero()) {
      return {
        poolAddress,
        walletAddress,
        baseTokenAddress: poolData.firstTokenId,
        quoteTokenAddress: poolData.secondTokenId,
        lpTokenAmount: 0,
        baseTokenAmount: 0,
        quoteTokenAmount: 0,
        price: 0,
      };
    }

    // Proportional share — mirrors Uniswap V2 position-info and xExchange removeLiquidity.
    // Alternative: pair ABI's getTokensForGivenPosition(lpBalance) gives the same result
    // with one extra RPC round-trip; skipped for parity and efficiency.
    const userBaseRaw = poolData.firstReserve.multipliedBy(lpBalance).dividedToIntegerBy(poolData.lpSupply);
    const userQuoteRaw = poolData.secondReserve.multipliedBy(lpBalance).dividedToIntegerBy(poolData.lpSupply);

    const baseTokenAmount = formatTokenAmount(userBaseRaw.toFixed(), firstDecimals);
    const quoteTokenAmount = formatTokenAmount(userQuoteRaw.toFixed(), secondDecimals);
    const lpTokenAmount = formatTokenAmount(lpBalance.toFixed(), lpDecimals);

    const baseReserveFloat = formatTokenAmount(poolData.firstReserve.toFixed(), firstDecimals);
    const quoteReserveFloat = formatTokenAmount(poolData.secondReserve.toFixed(), secondDecimals);
    const price = baseReserveFloat === 0 ? 0 : quoteReserveFloat / baseReserveFloat;

    logger.info(
      `Position info for ${walletAddress} in ${poolAddress}: lp=${lpTokenAmount}, base=${baseTokenAmount}, quote=${quoteTokenAmount}, price=${price}`,
    );

    return {
      poolAddress,
      walletAddress,
      baseTokenAddress: poolData.firstTokenId,
      quoteTokenAddress: poolData.secondTokenId,
      lpTokenAmount,
      baseTokenAmount,
      quoteTokenAmount,
      price,
    };
  } catch (e) {
    logger.error(`Error fetching position info: ${e.message}`);
    if (e.statusCode) throw e;
    if (e.message?.includes('bech32')) {
      throw fastify.httpErrors.badRequest(`Invalid wallet address: ${e.message}`);
    }
    throw fastify.httpErrors.internalServerError(`Failed to fetch position info: ${e.message}`);
  }
}

export const positionInfoRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: GetPositionInfoRequestType;
    Reply: PositionInfo;
  }>(
    '/position-info',
    {
      schema: {
        description: 'Get LP position info for a wallet on an xExchange AMM pair',
        tags: ['/connector/xexchange'],
        querystring: {
          ...GetPositionInfoRequest,
          properties: {
            ...GetPositionInfoRequest.properties,
            network: { type: 'string', default: 'mainnet' },
            poolAddress: {
              type: 'string',
              examples: ['erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq'],
            },
            walletAddress: {
              type: 'string',
              examples: ['erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'],
            },
          },
        },
        response: { 200: PositionInfoSchema },
      },
    },
    async (request) => {
      const multiversxConfig = getMultiversxChainConfig();
      const {
        poolAddress,
        network = multiversxConfig.defaultNetwork,
        walletAddress = multiversxConfig.defaultWallet,
      } = request.query;

      return getPositionInfo(fastify, network, poolAddress, walletAddress);
    },
  );
};

export default positionInfoRoute;
