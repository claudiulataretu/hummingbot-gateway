import { FastifyPluginAsync } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { getInitializedChain } from '../../services/connection-manager';
import { MultiversxController } from './multiversx.controllers';
import { Multiversx } from './multiversx';

// Define schemas
const StatusRequestSchema = Type.Object({
  network: Type.String(),
});

const TokensRequestSchema = Type.Object({
  network: Type.String(),
  tokenSymbols: Type.Optional(
    Type.Union([Type.String(), Type.Array(Type.String())]),
  ),
});

const BalanceRequestSchema = Type.Object({
  network: Type.String(),
  address: Type.String(),
  tokenSymbols: Type.Array(Type.String()),
});

const PollRequestSchema = Type.Object({
  network: Type.String(),
  txHash: Type.String(),
});

// Add response schemas
const StatusResponseSchema = Type.Object({
  chain: Type.String(),
  network: Type.String(),
  rpcUrl: Type.String(),
  currentBlockNumber: Type.Number(),
  nativeCurrency: Type.String(),
  timestamp: Type.Number(),
  latency: Type.Number(),
});

const TokensResponseSchema = Type.Object({
  tokens: Type.Array(
    Type.Object({
      symbol: Type.String(),
      decimals: Type.Number(),
      name: Type.String(),
      identifier: Type.String(),
    }),
  ),
  timestamp: Type.Number(),
  latency: Type.Number(),
});

const BalanceResponseSchema = Type.Object({
  balances: Type.Record(Type.String(), Type.String()),
  timestamp: Type.Number(),
  latency: Type.Number(),
});

const PollResponseSchema = Type.Object({
  currentBlock: Type.Number(),
  txHash: Type.String(),
  txStatus: Type.Number(),
  timestamp: Type.Number(),
  latency: Type.Number(),
});

// Export TypeScript types
export type TokensRequest = Static<typeof TokensRequestSchema>;
export type BalanceRequest = Static<typeof BalanceRequestSchema>;
export type PollRequest = Static<typeof PollRequestSchema>;

// Export response types
export type StatusResponse = Static<typeof StatusResponseSchema>;
export type TokensResponse = Static<typeof TokensResponseSchema>;
export type BalanceResponse = Static<typeof BalanceResponseSchema>;
export type PollResponse = Static<typeof PollResponseSchema>;

export type StatusRequest = Static<typeof StatusRequestSchema>;

export const multiversxRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /multiversx/status
  fastify.get<{ Querystring: StatusRequest; Reply: StatusResponse }>(
    '/status',
    {
      schema: {
        tags: ['multiversx'],
        description: 'Get MultiversX network status',
        querystring: StatusRequestSchema,
        response: {
          200: StatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const chain = await getInitializedChain<Multiversx>(
        'multiversx',
        request.query.network,
      );
      const status = await MultiversxController.getStatus(
        chain as Multiversx,
        request.query,
      );
      return reply.send(status);
    },
  );

  // GET /multiversx/tokens
  fastify.get<{ Querystring: TokensRequest; Reply: TokensResponse }>(
    '/tokens',
    {
      schema: {
        tags: ['multiversx'],
        description:
          'Get list of supported MultiversX tokens with their addresses and decimals',
        querystring: TokensRequestSchema,
        response: {
          200: TokensResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const chain = await getInitializedChain<Multiversx>(
        'multiversx',
        request.query.network,
      );
      const response = await MultiversxController.getTokens(
        chain as Multiversx,
        request.query,
      );
      return reply.send(response);
    },
  );

  // POST /multiversx/balances
  fastify.post<{ Body: BalanceRequest; Reply: BalanceResponse }>(
    '/balances',
    {
      schema: {
        tags: ['multiversx'],
        description: 'Get token balances for a MultiversX address',
        body: {
          ...BalanceRequestSchema,
          examples: [
            {
              network: 'mainnet',
              address: '<multiversx-address>',
              tokenSymbols: ['EGLD', 'USDC'],
            },
          ],
        },
        response: {
          200: BalanceResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const chain = await getInitializedChain<Multiversx>(
        'multiversx',
        request.body.network,
      );

      const response = await MultiversxController.balances(
        chain as Multiversx,
        request.body,
      );
      return reply.send(response);
    },
  );

  // POST /multiversx/poll
  fastify.post<{ Body: PollRequest; Reply: PollResponse }>(
    '/poll',
    {
      schema: {
        tags: ['multiversx'],
        description: 'Poll for the status of a MultiversX transaction',
        body: {
          ...PollRequestSchema,
          examples: [
            {
              network: 'mainnet',
              txHash: '',
            },
          ],
        },
        response: {
          200: PollResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const chain = await getInitializedChain<Multiversx>(
        'multiversx',
        request.body.network,
      );
      const response = await MultiversxController.poll(
        chain as Multiversx,
        request.body,
      );
      return reply.send(response);
    },
  );
};

export default multiversxRoutes;
