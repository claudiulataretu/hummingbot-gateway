import { FastifyInstance } from 'fastify';

// Import shared mocks before importing app
import '../../../mocks/app-mocks';

import { gatewayApp } from '../../../../src/app';
import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { getMultiversxStatus } from '../../../../src/chains/multiversx/routes/status';

jest.mock('../../../../src/chains/multiversx/multiversx');

const mockMultiversx = Multiversx as jest.Mocked<typeof Multiversx>;

describe('MultiversX Status Route', () => {
  let fastify: FastifyInstance;

  const mockInstance = {
    chain: 'multiversx',
    rpcUrl: 'https://gateway.multiversx.com',
    nativeTokenSymbol: 'EGLD',
    swapProvider: 'xexchange/amm',
    getCurrentBlockNumber: jest.fn(),
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
    mockInstance.getCurrentBlockNumber.mockResolvedValue(12345678);
  });

  describe('getMultiversxStatus function', () => {
    it('should return status with current block number', async () => {
      const result = await getMultiversxStatus(fastify, 'mainnet');

      expect(result).toEqual({
        chain: 'multiversx',
        network: 'mainnet',
        rpcUrl: 'https://gateway.multiversx.com',
        rpcProvider: 'url',
        currentBlockNumber: 12345678,
        nativeCurrency: 'EGLD',
        swapProvider: 'xexchange/amm',
      });

      expect(mockMultiversx.getInstance).toHaveBeenCalledWith('mainnet');
    });

    it('should return block 0 when getCurrentBlockNumber times out', async () => {
      mockInstance.getCurrentBlockNumber.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 100)),
      );

      const mockWarn = jest.spyOn(require('../../../../src/services/logger').logger, 'warn').mockImplementation();

      const result = await getMultiversxStatus(fastify, 'mainnet');

      expect(result.currentBlockNumber).toBe(0);
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Failed to get block number'));

      mockWarn.mockRestore();
    });

    it('should return block 0 when getCurrentBlockNumber throws', async () => {
      mockInstance.getCurrentBlockNumber.mockRejectedValue(new Error('Node unreachable'));

      const mockWarn = jest.spyOn(require('../../../../src/services/logger').logger, 'warn').mockImplementation();

      const result = await getMultiversxStatus(fastify, 'mainnet');

      expect(result.currentBlockNumber).toBe(0);
      expect(result.chain).toBe('multiversx');

      mockWarn.mockRestore();
    });

    it('should throw internalServerError when getInstance fails', async () => {
      mockMultiversx.getInstance.mockRejectedValue(new Error('Connection failed'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      await expect(getMultiversxStatus(fastify, 'mainnet')).rejects.toThrow();

      mockError.mockRestore();
    });
  });

  describe('GET /chains/multiversx/status', () => {
    it('should return 200 with chain status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/chains/multiversx/status?network=mainnet',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(data).toEqual({
        chain: 'multiversx',
        network: 'mainnet',
        rpcUrl: 'https://gateway.multiversx.com',
        rpcProvider: 'url',
        currentBlockNumber: 12345678,
        nativeCurrency: 'EGLD',
        swapProvider: 'xexchange/amm',
      });
    });

    it('should return 500 with fallback values when getInstance fails', async () => {
      mockMultiversx.getInstance.mockRejectedValue(new Error('Connection failed'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      const response = await fastify.inject({
        method: 'GET',
        url: '/chains/multiversx/status?network=mainnet',
      });

      expect(response.statusCode).toBe(500);
      const data = JSON.parse(response.body);

      expect(data).toEqual({
        chain: 'multiversx',
        network: 'mainnet',
        rpcUrl: 'unavailable',
        rpcProvider: 'unavailable',
        currentBlockNumber: 0,
        nativeCurrency: 'EGLD',
        swapProvider: '',
      });

      mockError.mockRestore();
    });
  });
});
