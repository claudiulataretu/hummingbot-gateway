import fs from 'fs';
import path from 'path';

import '../../mocks/app-mocks';

import { FastifyInstance } from 'fastify';

import { gatewayApp } from '../../../src/app';

jest.mock('../../../src/connectors/xexchange/xexchange');

describe('xExchange Routes Structure', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = gatewayApp;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  describe('Folder Structure', () => {
    const xexchangePath = path.join(__dirname, '../../../src/connectors/xexchange');

    it('should have amm-routes folder', () => {
      expect(fs.existsSync(path.join(xexchangePath, 'amm-routes'))).toBe(true);
    });

    it('should have quoteSwap.ts and executeSwap.ts in amm-routes', () => {
      const files = fs.readdirSync(path.join(xexchangePath, 'amm-routes'));
      expect(files).toContain('quoteSwap.ts');
      expect(files).toContain('executeSwap.ts');
    });

    it('should have ABI files', () => {
      expect(fs.existsSync(path.join(xexchangePath, 'router.abi.json'))).toBe(true);
      expect(fs.existsSync(path.join(xexchangePath, 'pair.abi.json'))).toBe(true);
    });

    it('should not have old-style route files at root', () => {
      const files = fs.readdirSync(xexchangePath);
      expect(files).not.toContain('routes.ts');
      expect(files).not.toContain('swap.ts');
    });
  });

  describe('Route Registration', () => {
    it('should register xexchange amm routes', () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('xexchange');
      expect(routes).toContain('amm');
    });

    it('should register quote-swap endpoint', () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('quote-swap');
    });

    it('should register execute-swap endpoint', () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('execute-swap');
    });
  });
});
