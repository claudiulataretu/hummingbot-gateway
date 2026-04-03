import { FastifyInstance } from 'fastify';

// Import shared mocks before importing app
import '../../../mocks/app-mocks';

import { gatewayApp } from '../../../../src/app';
import { estimateGasMultiversx } from '../../../../src/chains/multiversx/routes/estimate-gas';

describe('MultiversX Estimate Gas Route', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = gatewayApp;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('estimateGasMultiversx function', () => {
    it('should return hardcoded gas estimate values', async () => {
      const result = await estimateGasMultiversx('mainnet');

      expect(result).toMatchObject({
        feePerComputeUnit: 1000000000,
        denomination: 'EGLD',
        computeUnits: 50000,
        feeAsset: 'EGLD',
        fee: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('should calculate fee correctly (gasPrice * gasLimit / 1e18)', async () => {
      const result = await estimateGasMultiversx('mainnet');
      const expectedFee = (1000000000 * 50000) / 1e18;
      expect(result.fee).toBeCloseTo(expectedFee, 10);
    });

    it('should return a recent timestamp', async () => {
      const before = Date.now();
      const result = await estimateGasMultiversx('mainnet');
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return the same values for any network', async () => {
      const mainnet = await estimateGasMultiversx('mainnet');
      const devnet = await estimateGasMultiversx('devnet');

      expect(mainnet.feePerComputeUnit).toBe(devnet.feePerComputeUnit);
      expect(mainnet.computeUnits).toBe(devnet.computeUnits);
      expect(mainnet.denomination).toBe(devnet.denomination);
      expect(mainnet.feeAsset).toBe(devnet.feeAsset);
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
        feePerComputeUnit: 1000000000,
        denomination: 'EGLD',
        computeUnits: 50000,
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
      expect(data.denomination).toBe('EGLD');
      expect(typeof data.computeUnits).toBe('number');
      expect(data.feeAsset).toBe('EGLD');
      expect(typeof data.fee).toBe('number');
      expect(typeof data.timestamp).toBe('number');
    });
  });
});
