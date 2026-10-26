// Simple health check script run via node in Docker HEALTHCHECK
// Avoids external binary dependencies like curl or apk network downloads
import http from 'http';

const port = process.env.PORT || 3000;

const req = http.request(
  {
    host: '127.0.0.1',
    port: Number(port),
    path: '/health',
    method: 'GET',
    timeout: 3000,
  },
  (res) => {
    if (res.statusCode === 200) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  },
);

req.on('error', () => {
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});

req.end();
