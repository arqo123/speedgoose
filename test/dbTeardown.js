let mongoServer;

try {
  // Dynamically require to avoid Jest context issues
  mongoServer = require('./testUtils').mongoServer;
} catch (e) {
  mongoServer = null;
}

module.exports = async function stopTestDB() {
  if (mongoServer) {
    try {
      await mongoServer.stop();
    } catch (err) {
      console.error('Error stopping mongoServer:', err);
    }
  }
};