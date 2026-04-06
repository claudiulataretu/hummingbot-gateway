import { FastifyInstance } from 'fastify';

// Import shared mocks before importing app
import '../../../mocks/app-mocks';

import { gatewayApp } from '../../../../src/app';
import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { estimateGasMultiversx } from '../../../../src/chains/multiversx/routes/estimate-gas';

jest.mock('../../../../src/chains/multiversx/multiversx');

const mockMultiversx = Multiversx as jest.Mocked<typeof Multiversx>;

describe('MultiversX Estimate Gas Route', () => {
  let fastify: FastifyInstance;

  const mockInstance = {
    nativeTokenSymbol: 'EGLD',
    estimateGasPrice: jest.fn().mockResolvedValue({ minGasPrice: 1_000_000_000, minGasLimit: 50_000 }),
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
    mockInstance.estimateGasPrice.mockResolvedValue({ minGasPrice: 1_000_000_000, minGasLimit: 50_000 });
  });

  describe('estimateGasMultiversx function', () => {
    it('should return gas estimate from network', async () => {
      const result = await estimateGasMultiversx('mainnet');

      expect(result).toMatchObject({
        feePerComputeUnit: 1_000_000_000,
        denomination: 'atoms',
        computeUnits: 50_000,
        feeAsset: 'EGLD',
        fee: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('should calculate fee as (minGasPrice * minGasLimit) / 1e18', async () => {
      const result = await estimateGasMultiversx('mainnet');
      const expectedFee = (1_000_000_000 * 50_000) / 1e18;
      expect(result.fee).toBeCloseTo(expectedFee, 10);
    });

    it('should use values returned by estimateGasPrice()', async () => {
      mockInstance.estimateGasPrice.mockResolvedValue({ minGasPrice: 2_000_000_000, minGasLimit: 60_000 });

      const result = await estimateGasMultiversx('mainnet');

      expect(result.feePerComputeUnit).toBe(2_000_000_000);
      expect(result.computeUnits).toBe(60_000);
      expect(result.fee).toBeCloseTo((2_000_000_000 * 60_000) / 1e18, 10);
    });

    it('should return a recent timestamp', async () => {
      const before = Date.now();
      const result = await estimateGasMultiversx('mainnet');
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('should propagate fallback values when estimateGasPrice falls back to config', async () => {
      mockInstance.estimateGasPrice.mockResolvedValue({ minGasPrice: 1_000_000_000, minGasLimit: 50_000 });

      const result = await estimateGasMultiversx('mainnet');

      expect(result.feePerComputeUnit).toBe(1_000_000_000);
      expect(result.computeUnits).toBe(50_000);
    });
  });

  describe('GET /chains/multiversx/estimate-gas', () => {
    it('should return 200 with gas estimate', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/chains/multiversx/estimate-gas?network=mainnet',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(data).toMatchObject({
        feePerComputeUnit: 1_000_000_000,
        denomination: 'atoms',
        computeUnits: 50_000,
        feeAsset: 'EGLD',
        fee: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('should work without network parameter', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/chains/multiversx/estimate-gas',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toHaveProperty('feeAsset', 'EGLD');
    });

    it('should return consistent response format', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/chains/multiversx/estimate-gas?network=mainnet',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);

      expect(typeof data.feePerComputeUnit).toBe('number');
      expect(data.denomination).toBe('atoms');
      expect(typeof data.computeUnits).toBe('number');
      expect(data.feeAsset).toBe('EGLD');
      expect(typeof data.fee).toBe('number');
      expect(typeof data.timestamp).toBe('number');
    });
  });
});
