// Jest setup file
// Add global test utilities and configurations here

// Increase timeout for Firestore emulator tests
jest.setTimeout(30000);

// Add BigInt serialization support for Jest
// @ts-ignore
BigInt.prototype.toJSON = function() {
  return this.toString();
};
