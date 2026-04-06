import { FastifyPluginAsync } from 'fastify';

import {
  EstimateGasRequestSchema,
  EstimateGasRequestType,
  EstimateGasResponse,
  EstimateGasResponseSchema,
} from '#src/schemas/chain-schema';

import { Multiversx } from '../multiversx';

export async function estimateGasMultiversx(network: string): Promise<EstimateGasResponse> {
  const multiversx = await Multiversx.getInstance(network);
  const { minGasPrice, minGasLimit } = await multiversx.estimateGasPrice();
  const feeInEGLD = (minGasPrice * minGasLimit) / 1e18;

  return {
    feePerComputeUnit: minGasPrice,
    denomination: 'atoms',
    computeUnits: minGasLimit,
    feeAsset: multiversx.nativeTokenSymbol,
    fee: feeInEGLD,
    timestamp: Date.now(),
  };
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
