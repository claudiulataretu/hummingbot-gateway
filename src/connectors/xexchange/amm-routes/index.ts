import { FastifyPluginAsync } from 'fastify';

import { executeSwapRoute } from './executeSwap';
import { quoteSwapRoute } from './quoteSwap';

export const xexchangeAmmRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(quoteSwapRoute);
  await fastify.register(executeSwapRoute);
};

export default xexchangeAmmRoutes;
