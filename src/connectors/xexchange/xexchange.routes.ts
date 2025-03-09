import { FastifyPluginAsync } from 'fastify';
import {
  PriceRequest,
  PriceResponse,
  TradeRequest,
  TradeResponse,
  EstimateGasResponse,
  PriceRequestSchema,
  PriceResponseSchema,
  TradeRequestSchema,
  TradeResponseSchema,
  EstimateGasResponseSchema,
} from '../connector.requests';
import {
  validateEstimateGasRequest,
  validatePriceRequest,
  validateTradeRequest,
} from '../connector.validators';
import {
  NetworkSelectionSchema,
  NetworkSelectionRequest,
} from '../../services/common-interfaces';
import { Multiversx } from '../../chains/multiversx/multiversx';
import { XExchange } from './xexchange';
import { estimateGas, price, trade } from './xexchange.controller';

export const xexchangeRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /xexchange/price
  fastify.post<{ Body: PriceRequest; Reply: PriceResponse }>(
    '/price',
    {
      schema: {
        description: 'Get Xexchange price quote',
        tags: ['xexchange'],
        body: PriceRequestSchema,
        response: {
          200: PriceResponseSchema,
        },
      },
    },
    async (request) => {
      validatePriceRequest(request.body);
      const multiversx = await Multiversx.getInstance(request.body.network);
      const xexchange = await XExchange.getInstance(request.body.network);
      return await price(multiversx, xexchange, request.body);
    },
  );

  // POST /xexchange/trade
  fastify.post<{ Body: TradeRequest; Reply: TradeResponse }>(
    '/trade',
    {
      schema: {
        description: 'Execute Xexchange trade',
        tags: ['xexchange'],
        body: TradeRequestSchema,
        response: {
          200: TradeResponseSchema,
        },
      },
    },
    async (request) => {
      validateTradeRequest(request.body);
      const multiversx = await Multiversx.getInstance(request.body.network);
      const xexchange = await XExchange.getInstance(request.body.network);
      console.log('Trade request payload:', request.body);
      try {
        return await trade(multiversx, xexchange, request.body);
      } catch (error) {
        console.error('xExchange trade error:', error);
        throw error;
      }
    },
  );

  // POST /xexchange/estimateGas
  fastify.post<{ Body: NetworkSelectionRequest; Reply: EstimateGasResponse }>(
    '/estimateGas',
    {
      schema: {
        description: 'Estimate Xexchange gas',
        tags: ['xexchange'],
        body: NetworkSelectionSchema,
        response: {
          200: EstimateGasResponseSchema,
        },
      },
    },
    async (request) => {
      validateEstimateGasRequest(request.body);
      const multiversx = await Multiversx.getInstance(request.body.network);
      const xexchange = await XExchange.getInstance(request.body.network);
      return await estimateGas(multiversx, xexchange);
    },
  );
};

export default xexchangeRoutes;
