import client from 'prom-client';

client.collectDefaultMetrics();

export { client };