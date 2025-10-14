import sensible from '@fastify/sensible';
import { FastifyPluginAsync } from 'fastify';

import { xexchangeAmmRoutes } from './amm-routes';

// AMM routes (xExchange V2)
const xexchangeAmmRoutesWrapper: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);

  await fastify.register(async (instance) => {
    instance.addHook('onRoute', (routeOptions) => {
      if (routeOptions.schema && routeOptions.schema.tags) {
        routeOptions.schema.tags = ['/connector/xexchange'];
      }
    });

    await instance.register(xexchangeAmmRoutes);
  });
};

export const xExchageRoutes = {
  amm: xexchangeAmmRoutesWrapper,
};

export default xExchageRoutes;
