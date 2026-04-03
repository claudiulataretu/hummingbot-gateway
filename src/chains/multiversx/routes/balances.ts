import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import {
  BalanceRequestSchema,
  BalanceRequestType,
  BalanceResponseType,
  BalanceResponseSchema,
} from '../../../schemas/chain-schema';
import { logger } from '../../../services/logger';
import { Multiversx } from '../multiversx';

export async function getMultiversxBalances(
  fastify: FastifyInstance,
  network: string,
  address: string,
  tokens?: string[],
): Promise<BalanceResponseType> {
  try {
    const multiversx = await Multiversx.getInstance(network);
    const balances = await multiversx.getBalances(address, tokens);
    return { balances };
  } catch (error) {
    logger.error(`Error getting balances: ${error.message}`);
    throw fastify.httpErrors.internalServerError(`Failed to get balances: ${error.message}`);
  }
}

export const balancesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: BalanceRequestType;
    Reply: BalanceResponseType;
  }>(
    '/balances',
    {
      schema: {
        description:
          'Get Multiversx balances. If no tokens specified or empty array provided, returns native token (EGLD) and only non-zero balances for tokens from the token list. If specific tokens are requested, returns those exact tokens with their balances, including zeros.',
        tags: ['/chain/multiversx'],
        body: BalanceRequestSchema,
        response: {
          200: BalanceResponseSchema,
        },
      },
    },
    async (request) => {
      const { network, address, tokens } = request.body;
      return await getMultiversxBalances(fastify, network, address, tokens);
    },
  );
};

export default balancesRoute;
