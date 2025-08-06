/**
 * Global teardown for integration tests
 */

module.exports = async () => {
  console.log('🏁 Integration tests completed');
  
  // Clean up any test data if needed
  // For now, just log completion
  process.exit(0);
};