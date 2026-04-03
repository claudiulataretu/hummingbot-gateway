import { FastifyInstance } from 'fastify';

// Import shared mocks before importing app
import '../../../mocks/app-mocks';

import { gatewayApp } from '../../../../src/app';
import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { pollMultiversxTransaction } from '../../../../src/chains/multiversx/routes/poll';

jest.mock('../../../../src/chains/multiversx/multiversx');

const mockMultiversx = Multiversx as jest.Mocked<typeof Multiversx>;

const TEST_TX_HASH = 'abc123def456';

const makeTxData = (isPending: boolean, isSuccessful: boolean, blockNonce = 1000) => ({
  blockNonce,
  status: {
    isPending: jest.fn().mockReturnValue(isPending),
    isSuccessful: jest.fn().mockReturnValue(isSuccessful),
  },
});

describe('MultiversX Poll Route', () => {
  let fastify: FastifyInstance;

  const mockInstance = {
    getCurrentBlockNumber: jest.fn(),
    getTransaction: jest.fn(),
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
    mockInstance.getCurrentBlockNumber.mockResolvedValue(99999);
  });

  describe('pollMultiversxTransaction function', () => {
    it('should return successful transaction status', async () => {
      const txData = makeTxData(false, true, 99800);
      mockInstance.getTransaction.mockResolvedValue(txData);

      const result = await pollMultiversxTransaction(fastify, 'mainnet', TEST_TX_HASH);

      expect(result).toMatchObject({
        currentBlock: 99999,
        signature: TEST_TX_HASH,
        txBlock: 99800,
        txStatus: 1,
        txData,
        fee: null,
      });
    });

    it('should return pending status (txStatus 0) for pending transaction', async () => {
      const txData = makeTxData(true, false, 99900);
      mockInstance.getTransaction.mockResolvedValue(txData);

      const result = await pollMultiversxTransaction(fastify, 'mainnet', TEST_TX_HASH);

      expect(result.txStatus).toBe(0);
      expect(result.txBlock).toBe(99900);
    });

    it('should return failed status (txStatus -1) for failed transaction', async () => {
      const txData = makeTxData(false, false, 99800);
      mockInstance.getTransaction.mockResolvedValue(txData);

      const result = await pollMultiversxTransaction(fastify, 'mainnet', TEST_TX_HASH);

      expect(result.txStatus).toBe(-1);
    });

    it('should return txStatus -1 and txBlock -1 when tx not found after retries', async () => {
      // Mock setTimeout to skip delays
      const originalSetTimeout = global.setTimeout;
      (global as any).setTimeout = (fn: () => void) => fn();

      mockInstance.getTransaction.mockResolvedValue(null);

      const mockInfo = jest.spyOn(require('../../../../src/services/logger').logger, 'info').mockImplementation();

      const result = await pollMultiversxTransaction(fastify, 'mainnet', TEST_TX_HASH);

      expect(result.txBlock).toBe(-1);
      expect(result.txStatus).toBe(-1);
      expect(result.txData).toBeNull();

      global.setTimeout = originalSetTimeout;
      mockInfo.mockRestore();
    }, 15000);

    it('should throw internalServerError when an unexpected error occurs', async () => {
      mockInstance.getCurrentBlockNumber.mockRejectedValue(new Error('RPC down'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      await expect(pollMultiversxTransaction(fastify, 'mainnet', TEST_TX_HASH)).rejects.toThrow();

      mockError.mockRestore();
    });
  });

  describe('POST /chains/multiversx/poll', () => {
    it('should return 200 with transaction status', async () => {
      const txData = makeTxData(false, true, 99800);
      mockInstance.getTransaction.mockResolvedValue(txData);

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/poll',
        payload: {
          network: 'mainnet',
          signature: TEST_TX_HASH,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.signature).toBe(TEST_TX_HASH);
      expect(data.txStatus).toBe(1);
      expect(data.currentBlock).toBe(99999);
    });

    it('should return 400 when signature is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/poll',
        payload: {
          network: 'mainnet',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 500 on unexpected error', async () => {
      mockInstance.getCurrentBlockNumber.mockRejectedValue(new Error('Unexpected'));

      const mockError = jest.spyOn(require('../../../../src/services/logger').logger, 'error').mockImplementation();

      const response = await fastify.inject({
        method: 'POST',
        url: '/chains/multiversx/poll',
        payload: {
          network: 'mainnet',
          signature: TEST_TX_HASH,
        },
      });

      expect(response.statusCode).toBe(500);

      mockError.mockRestore();
    });
  });
});
