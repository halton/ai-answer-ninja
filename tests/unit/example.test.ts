// Example unit test to verify test framework
describe('Example Test Suite', () => {
  test('should run basic test', () => {
    expect(true).toBe(true);
  });

  test('should test basic math', () => {
    expect(2 + 2).toBe(4);
  });

  test('should test string operations', () => {
    const testString = 'AI Answer Ninja';
    expect(testString).toContain('AI');
    expect(testString.length).toBeGreaterThan(0);
  });
});