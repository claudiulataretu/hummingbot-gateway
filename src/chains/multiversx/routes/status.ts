import { FastifyPluginAsync } from 'fastify';

import {
  StatusRequestSchema,
  StatusRequestType,
  StatusResponseType,
  StatusResponseSchema,
} from '../../../schemas/chain-schema';
import { logger } from '../../../services/logger';
import { Multiversx } from '../multiversx';

export async function getMultiversxStatus(network: string): Promise<StatusResponseType> {
  try {
    const multiversx = await Multiversx.getInstance(network);
    const chain = multiversx.chain;
    const rpcUrl = multiversx.rpcUrl;
    const rpcProvider = 'url';
    const nativeCurrency = multiversx.nativeTokenSymbol;

    // Directly try to get the current block number with a timeout
    let currentBlockNumber = 0;
    try {
      // Set up a timeout promise to prevent hanging on unresponsive nodes
      const blockPromise = multiversx.getCurrentBlockNumber();
      const timeoutPromise = new Promise<number>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), 5000);
      });

      // Race the block request against the timeout
      currentBlockNumber = await Promise.race([blockPromise, timeoutPromise]);
    } catch (blockError) {
      logger.warn(`Failed to get block number: ${blockError.message}`);
      // Continue with default block number
    }

    return {
      chain,
      network,
      rpcUrl,
      rpcProvider,
      currentBlockNumber,
      nativeCurrency,
      swapProvider: multiversx.swapProvider,
    };
  } catch (error) {
    logger.error(`Error getting Multiversx status: ${error.message}`);
    throw new Error(`Failed to get Multiversx status: ${error.message}`);
  }
}

export const statusRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: StatusRequestType;
    Reply: StatusResponseType;
  }>(
    '/status',
    {
      schema: {
        description: 'Get Multiversx chain status',
        tags: ['/chain/multiversx'],
        querystring: StatusRequestSchema,
        response: {
          200: StatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { network } = request.query;
      try {
        // This will handle node timeout internally
        return await getMultiversxStatus(network);
      } catch (error) {
        // This will catch any other unexpected errors
        logger.error(`Error in Multiversx status endpoint: ${error.message}`);
        reply.status(500);
        // Return a minimal valid response
        return {
          chain: 'multiversx',
          network,
          rpcUrl: 'unavailable',
          rpcProvider: 'unavailable',
          currentBlockNumber: 0,
          nativeCurrency: 'EGLD',
          swapProvider: '',
        };
      }
    },
  );
};

export default statusRoute;
