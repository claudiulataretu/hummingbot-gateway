import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import {
  PollRequestSchema,
  PollRequestType,
  PollResponseType,
  PollResponseSchema,
} from '../../../schemas/chain-schema';
import { logger } from '../../../services/logger';
import { Multiversx } from '../multiversx';

export async function pollMultiversxTransaction(
  fastify: FastifyInstance,
  network: string,
  txHash: string,
): Promise<PollResponseType> {
  try {
    const multiversx = await Multiversx.getInstance(network);

    const currentBlock = await multiversx.getCurrentBlockNumber();
    let txData = await multiversx.getTransaction(txHash);
    let txBlock: number, txStatus: number;

    if (!txData) {
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        txData = await multiversx.getTransaction(txHash);
        if (txData) break;
        retryCount++;
      }

      if (!txData) {
        // tx not found after retries
        logger.info(`Transaction ${txHash} not found in mempool or does not exist after ${MAX_RETRIES} retries.`);
        txBlock = -1;
        txStatus = -1;
      }
    }

    if (txData) {
      txBlock = txData.blockNonce;
      txStatus = txData.status.isPending() ? 0 : txData.status.isSuccessful() ? 1 : -1;
    }

    logger.info(`Poll multiversx, signature ${txHash}, status ${txStatus}.`);

    return {
      currentBlock,
      signature: txHash,
      txBlock,
      txStatus,
      txData: txData,
      fee: null, // Optional field
    };
  } catch (error) {
    if (error.statusCode) {
      throw error; // Re-throw if it's already a Fastify error
    }
    logger.error(`Error polling transaction: ${error.message}`);
    throw fastify.httpErrors.internalServerError(`Failed to poll transaction: ${error.message}`);
  }
}

export const pollRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: PollRequestType;
    Reply: PollResponseType;
  }>(
    '/poll',
    {
      schema: {
        description: 'Poll Multiversx transaction status',
        tags: ['/chain/multiversx'],
        body: PollRequestSchema,
        response: {
          200: PollResponseSchema,
        },
      },
    },
    async (request) => {
      const { network, signature } = request.body;
      return await pollMultiversxTransaction(fastify, network, signature);
    },
  );
};

export default pollRoute;
