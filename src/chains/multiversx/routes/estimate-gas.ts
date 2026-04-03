import { FastifyPluginAsync } from 'fastify';

import {
  EstimateGasRequestSchema,
  EstimateGasRequestType,
  EstimateGasResponse,
  EstimateGasResponseSchema,
} from '#src/schemas/chain-schema';
import { logger } from '#src/services/logger';

export async function estimateGasMultiversx(network: string): Promise<EstimateGasResponse> {
  try {
    const gasPrice = 1000000000;
    const DEFAULT_GAS_LIMIT = 50000;
    // Calculate total fee in GWEI
    const totalFeeInGwei = gasPrice * DEFAULT_GAS_LIMIT;

    // Convert GWEI to EGLD (1 EGLD = 10^18 GWEI)
    const totalFeeInEGLD = totalFeeInGwei / 1e18;

    return {
      feePerComputeUnit: gasPrice,
      denomination: 'EGLD',
      computeUnits: DEFAULT_GAS_LIMIT,
      feeAsset: 'EGLD',
      fee: totalFeeInEGLD,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error(`Error estimating gas for network ${network}: ${error.message}`);
  }
}

export const estimateGasRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: EstimateGasRequestType;
    Reply: EstimateGasResponse;
  }>(
    '/estimate-gas',
    {
      schema: {
        description: 'Estimate gas prices for MultiversX transactions',
        tags: ['/chain/multiversx'],
        querystring: EstimateGasRequestSchema,
        response: {
          200: EstimateGasResponseSchema,
        },
      },
    },
    async (request) => {
      const { network } = request.query;
      return await estimateGasMultiversx(network);
    },
  );
};

export default estimateGasRoute;
