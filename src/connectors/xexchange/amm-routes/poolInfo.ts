import { FastifyPluginAsync } from 'fastify';

import { formatTokenAmount } from '#src/connectors/uniswap/uniswap.utils';
import { GetPoolInfoRequest, GetPoolInfoRequestType, PoolInfoSchema } from '#src/schemas/amm-schema';
import { logger } from '#src/services/logger';

import { XExchange } from '../xexchange';

export const poolInfoRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: GetPoolInfoRequestType;
    Reply: typeof PoolInfoSchema._type;
  }>(
    '/pool-info',
    {
      schema: {
        description: 'Get pool info for an xExchange AMM pair',
        tags: ['/connector/xexchange'],
        querystring: {
          ...GetPoolInfoRequest,
          properties: {
            ...GetPoolInfoRequest.properties,
            network: { type: 'string', default: 'mainnet' },
            poolAddress: {
              type: 'string',
              examples: ['erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq'],
            },
          },
        },
        response: { 200: PoolInfoSchema },
      },
    },
    async (request) => {
      const { poolAddress, network = 'mainnet' } = request.query;

      try {
        const xexchange = await XExchange.getInstance(network);
        const poolData = await xexchange.getPoolData(poolAddress);

        const firstDecimals = xexchange.getTokenByName(poolData.firstTokenId.split('-')[0])?.decimals ?? 18;
        const secondDecimals = xexchange.getTokenByName(poolData.secondTokenId.split('-')[0])?.decimals ?? 18;

        const baseTokenAmount = formatTokenAmount(poolData.firstReserve.toFixed(), firstDecimals);
        const quoteTokenAmount = formatTokenAmount(poolData.secondReserve.toFixed(), secondDecimals);
        const price = quoteTokenAmount / baseTokenAmount;
        // totalFeePercent denominator is 100_000 (e.g., 300 = 0.3%)
        const feePct = poolData.totalFeePercent / 1000;

        logger.info(`Pool info for ${poolAddress}: price=${price}, feePct=${feePct}`);

        return {
          address: poolAddress,
          baseTokenAddress: poolData.firstTokenId,
          quoteTokenAddress: poolData.secondTokenId,
          feePct,
          price,
          baseTokenAmount,
          quoteTokenAmount,
        };
      } catch (e) {
        logger.error(`Error fetching pool info: ${e.message}`);
        if (e.statusCode) throw e;
        throw fastify.httpErrors.internalServerError(`Failed to fetch pool info: ${e.message}`);
      }
    },
  );
};

export default poolInfoRoute;
