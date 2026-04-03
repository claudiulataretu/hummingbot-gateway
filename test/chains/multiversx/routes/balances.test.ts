import { FastifyInstance } from 'fastify';

// Import shared mocks before importing app
import '../../../mocks/app-mocks';

import { gatewayApp } from '../../../../src/app';
import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { getMultiversxBalances } from '../../../../src/chains/multiversx/routes/balances';

jest.mock('../../../../src/chains/multiversx/multiversx');

const mockMultiversx = Multiversx as jest.Mocked<typeof Multiversx>;

const TEST_ADDRESS = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';

describe('MultiversX Balances Route', () => {
  let fastify: FastifyInstance;

  const mockInstance = {
    getBalances: jest.fn(),
  };

  beforeAll(async () => {
    fastify = gatewayApp;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMultiversx.getInstance.mockResolvedValue(mockInstance as any);
  });

  describe('getMultiversxBalances function', () => {
    it('should return balances for all tokens', async () => {
      mockInstance.getBalances.mockResolvedValue({ EGLD: 1.5, USDC: 100 });

      const result = await getMultiversxBalances(fastify, 'mainnet', TEST_ADDRESS);

      expect(result).toEqual({ balances: { EGLD: 1.5, USDC: 100 } });
      expect(mockMultiversx.getInstance).toHaveBeenCalledWith('mainnet');
      expect(mockInstance.getBalances).toHaveBeenCalledWith(TEST_ADDRESS, undefined);
    });

    it('should return balances for specific tokens', async () => {
      mockInstance.getBalances.mockResolvedValue({ EGLD: 1.5 });

      const result = await getMultiversxBalances(fastify, 'mainnet', TEST_ADDRESS, ['EGLD']);

      expect(result).toEqual({ balances: { EGLD: 1.5 } });
      expect(mockInstance.getBalances).toHaveBeenCalledWith(TEST_ADDRESS, ['EGLD']);
    });

    it('should throw internalServerError when getBalances fails', async () => {
      mockInstance.getBalances.mockRejectedValue(new Error('RPC error'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      await expect(getMultiversxBalances(fastify, 'mainnet', TEST_ADDRESS)).rejects.toThrow();

      mockError.mockRestore();
    });
  });

  describe('POST /chains/multiversx/balances', () => {
    it('should return 200 with token balances', async () => {
      mockInstance.getBalances.mockResolvedValue({ EGLD: 2.5, USDC: 50.0 });

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/balances',
        payload: {
          network: 'mainnet',
          address: TEST_ADDRESS,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toEqual({ balances: { EGLD: 2.5, USDC: 50.0 } });
    });

    it('should pass tokens array when specified', async () => {
      mockInstance.getBalances.mockResolvedValue({ EGLD: 1.0 });

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/balances',
        payload: {
          network: 'mainnet',
          address: TEST_ADDRESS,
          tokens: ['EGLD'],
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toEqual({ balances: { EGLD: 1.0 } });
      expect(mockInstance.getBalances).toHaveBeenCalledWith(TEST_ADDRESS, ['EGLD']);
    });

    it('should call getBalances with undefined address when not provided', async () => {
      mockInstance.getBalances.mockResolvedValue({ EGLD: 0 });

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/balances',
        payload: {
          network: 'mainnet',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockInstance.getBalances).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should return 500 when chain call fails', async () => {
      mockInstance.getBalances.mockRejectedValue(new Error('Network error'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/balances',
        payload: {
          network: 'mainnet',
          address: TEST_ADDRESS,
        },
      });

      expect(response.statusCode).toBe(500);

      mockError.mockRestore();
    });
  });
});
