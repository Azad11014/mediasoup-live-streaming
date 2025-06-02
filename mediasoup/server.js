const express = require('express');
const mediasoup = require('mediasoup');
const config = require('./config');

const app = express();
const httpServer = app.listen(config.listenPort, config.listenIp, () => {
  console.log(`Mediasoup server running on http://${config.listenIp}:${config.listenPort}`);
});

let worker, router;

async function startMediasoup() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting...');
    process.exit(1);
  });

  router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
}

startMediasoup();

app.get('/router-capabilities', (req, res) => {
  if (!router) {
    return res.status(500).json({ error: 'Router not initialized' });
  }
  res.json({ rtpCapabilities: router.rtpCapabilities });
});

app.post('/createProducerTransport', async (req, res) => {
  try {
    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  } catch (error) {
    console.error('Error creating producer transport:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/createConsumerTransport', async (req, res) => {
  try {
    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  } catch (error) {
    console.error('Error creating consumer transport:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/connectTransport', async (req, res) => {
  const { transportId, dtlsParameters } = req.body;
  try {
    const transport = router.transports.find(t => t.id === transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    await transport.connect({ dtlsParameters });
    res.json({ success: true });
  } catch (error) {
    console.error('Error connecting transport:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/produce', async (req, res) => {
  const { transportId, kind, rtpParameters } = req.body;
  try {
    const transport = router.transports.find(t => t.id === transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    const producer = await transport.produce({ kind, rtpParameters });
    res.json({ id: producer.id });
  } catch (error) {
    console.error('Error producing:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/consume', async (req, res) => {
  const { transportId, producerId, rtpCapabilities } = req.body;
  try {
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return res.status(400).json({ error: 'Cannot consume this producer' });
    }
    const transport = router.transports.find(t => t.id === transportId);
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });
    res.json({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  } catch (error) {
    console.error('Error consuming:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/closeProducer', async (req, res) => {
  const { producerId } = req.body;
  try {
    const producer = router.producers.find(p => p.id === producerId);
    if (!producer) {
      return res.status(404).json({ error: 'Producer not found' });
    }
    producer.close();
    res.json({ success: true });
  } catch (error) {
    console.error('Error closing producer:', error);
    res.status(500).json({ error: error.message });
  }
});