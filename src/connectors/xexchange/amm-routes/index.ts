import { FastifyPluginAsync } from 'fastify';

import { addLiquidityRoute } from './addLiquidity';
import { executeSwapRoute } from './executeSwap';
import { poolInfoRoute } from './poolInfo';
import { quoteSwapRoute } from './quoteSwap';
import { removeLiquidityRoute } from './removeLiquidity';

export const xexchangeAmmRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(poolInfoRoute);
  await fastify.register(quoteSwapRoute);
  await fastify.register(executeSwapRoute);
  await fastify.register(addLiquidityRoute);
  await fastify.register(removeLiquidityRoute);
};

export default xexchangeAmmRoutes;
