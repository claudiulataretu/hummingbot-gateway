// Mock fs-extra to prevent actual file writes
jest.mock('fs-extra');
jest.mock('@multiversx/sdk-core');

import * as fse from 'fs-extra';

// Import shared mocks before importing app
import '../../mocks/app-mocks';

import { Multiversx } from '../../../src/chains/multiversx/multiversx';

const mockFse = fse as jest.Mocked<typeof fse>;

const TEST_ADDRESS = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';

const MOCK_ENCRYPTED_KEY = JSON.stringify({
  address: TEST_ADDRESS,
  id: 'test-id',
  version: 3,
  crypto: { cipher: 'aes-128-ctr', ciphertext: 'mock' },
});

// Configure MultiversX SDK mocks
const sdkCoreMock = require('@multiversx/sdk-core');
const mockAddress = {
  toBech32: jest.fn().mockReturnValue(TEST_ADDRESS),
};
const mockSigner = {
  getAddress: jest.fn().mockReturnValue(mockAddress),
};
const mockSecretKey = {};
const mockWalletJson = { address: TEST_ADDRESS, version: 3 };

sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));
sdkCoreMock.UserSecretKey = jest.fn().mockImplementation(() => mockSecretKey);
sdkCoreMock.UserSigner = jest.fn().mockImplementation(() => mockSigner);
sdkCoreMock.UserSigner.fromWallet = jest.fn().mockReturnValue(mockSigner);
sdkCoreMock.UserWallet = {
  fromSecretKey: jest.fn().mockReturnValue({ toJSON: jest.fn().mockReturnValue(mockWalletJson) }),
};
sdkCoreMock.ProxyNetworkProvider = jest.fn().mockImplementation(() => ({
  getAccount: jest.fn(),
  getNetworkStatus: jest.fn(),
  getTransaction: jest.fn(),
  getFungibleTokenOfAccount: jest.fn(),
}));

let multiversx: Multiversx;

beforeAll(async () => {
  (mockFse.readFile as jest.Mock).mockResolvedValue(Buffer.from(MOCK_ENCRYPTED_KEY));
  (mockFse.pathExists as jest.Mock).mockResolvedValue(true);
  (mockFse.ensureDir as jest.Mock).mockResolvedValue(undefined);
  (mockFse.writeFile as jest.Mock).mockResolvedValue(undefined);
  (mockFse.readdir as jest.Mock).mockResolvedValue([]);
  (mockFse.mkdir as jest.Mock).mockResolvedValue(undefined);

  multiversx = await Multiversx.getInstance('mainnet');
});

afterAll(async () => {
  await multiversx.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  sdkCoreMock.UserSigner.fromWallet = jest.fn().mockReturnValue(mockSigner);
  sdkCoreMock.UserWallet.fromSecretKey = jest.fn().mockReturnValue({
    toJSON: jest.fn().mockReturnValue(mockWalletJson),
  });
  (mockFse.readFile as jest.Mock).mockResolvedValue(Buffer.from(MOCK_ENCRYPTED_KEY));
  (mockFse.pathExists as jest.Mock).mockResolvedValue(true);
});

describe('Multiversx Wallet Methods', () => {
  describe('validateAddress', () => {
    it('should accept a valid bech32 address', () => {
      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));
      const validAddr = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';
      expect(() => Multiversx.validateAddress(validAddr)).not.toThrow();
    });

    it('should reject an address that is too short', () => {
      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));
      expect(() => Multiversx.validateAddress('erd1tooshort')).toThrow('Invalid Multiversx address format');
    });

    it('should reject an address that is too long', () => {
      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));
      const tooLong = 'erd1' + 'q'.repeat(65);
      expect(() => Multiversx.validateAddress(tooLong)).toThrow('Invalid Multiversx address format');
    });

    it('should reject when Address constructor throws', () => {
      sdkCoreMock.Address = jest.fn().mockImplementation(() => {
        throw new Error('Invalid bech32');
      });
      expect(() => Multiversx.validateAddress('invalid-address')).toThrow('Invalid Multiversx address format');
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt a private key and return JSON string', () => {
      const testKey = Buffer.from('0'.repeat(64), 'utf8').toString('base64'); // noqa: mock
      const result = multiversx.encrypt(testKey, 'password');
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockWalletJson);
    });

    it('should throw on encrypt with invalid private key', () => {
      sdkCoreMock.UserSecretKey = jest.fn().mockImplementation(() => {
        throw new Error('Invalid key');
      });
      const testKey = Buffer.from('0'.repeat(64), 'utf8').toString('base64'); // noqa: mock
      expect(() => multiversx.encrypt(testKey, 'password')).toThrow('Invalid privateKey');
    });

    it('should decrypt an encrypted private key and return UserSigner', () => {
      const result = multiversx.decrypt(MOCK_ENCRYPTED_KEY, 'password');
      expect(result).toBe(mockSigner);
      expect(sdkCoreMock.UserSigner.fromWallet).toHaveBeenCalledWith(JSON.parse(MOCK_ENCRYPTED_KEY), 'password');
    });
  });

  describe('getWalletFromPrivateKey', () => {
    it('should return a UserSigner', () => {
      sdkCoreMock.UserSecretKey = jest.fn().mockImplementation(() => mockSecretKey);
      const testKey = Buffer.from('0'.repeat(64), 'utf8').toString('base64'); // noqa: mock
      const result = multiversx.getWalletFromPrivateKey(testKey);
      expect(result).toBeDefined();
    });
  });

  describe('getWallet', () => {
    it('should return a signer when wallet file exists', async () => {
      const { ConfigManagerCertPassphrase } = require('../../../src/services/config-manager-cert-passphrase');
      const spy = jest.spyOn(multiversx, 'decrypt').mockReturnValue(mockSigner as any);

      const mockPassphrase = jest
        .spyOn(ConfigManagerCertPassphrase, 'readPassphrase')
        .mockReturnValue('test-passphrase');

      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));

      const result = await multiversx.getWallet(TEST_ADDRESS);
      expect(result).toBe(mockSigner);

      spy.mockRestore();
      mockPassphrase.mockRestore();
    });

    it('should throw when wallet file does not exist', async () => {
      const { ConfigManagerCertPassphrase } = require('../../../src/services/config-manager-cert-passphrase');
      const mockPassphrase = jest
        .spyOn(ConfigManagerCertPassphrase, 'readPassphrase')
        .mockReturnValue('test-passphrase');

      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));
      (mockFse.readFile as jest.Mock).mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
      );

      await expect(multiversx.getWallet(TEST_ADDRESS)).rejects.toThrow('Wallet not found');

      mockPassphrase.mockRestore();
    });

    it('should throw when passphrase is missing', async () => {
      const { ConfigManagerCertPassphrase } = require('../../../src/services/config-manager-cert-passphrase');
      const mockPassphrase = jest.spyOn(ConfigManagerCertPassphrase, 'readPassphrase').mockReturnValue(null);

      sdkCoreMock.Address = jest.fn().mockImplementation(() => ({}));

      await expect(multiversx.getWallet(TEST_ADDRESS)).rejects.toThrow('Missing passphrase');

      mockPassphrase.mockRestore();
    });

    it('should throw for an invalid address format', async () => {
      await expect(multiversx.getWallet('not-valid')).rejects.toThrow('Invalid Multiversx address format');
    });
  });
});
