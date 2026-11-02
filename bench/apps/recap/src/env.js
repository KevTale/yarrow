// Reads .env when there is one; the real environment wins.
try {
  process.loadEnvFile();
} catch {
  // No .env: the environment is set another way.
}
