// const express = require('express');
// const { Server } = require('socket.io');
// const mediasoup = require('mediasoup');
// const config = require('./config');

// const app = express();
// const httpServer = app.listen(config.listenPort, config.listenIp, () => {
//   console.log(`Server running on http://${config.listenIp}:${config.listenPort}`);
// });

// const io = new Server(httpServer, { cors: { origin: 'http://127.0.0.1:8000' } });

// let worker, router;

// async function startMediasoup() {
//   worker = await mediasoup.createWorker(config.mediasoup.worker);
//   router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
// }

// startMediasoup();

// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);

//   socket.on('createProducerTransport', async (callback) => {
//     const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
//     callback({
//       id: transport.id,
//       iceParameters: transport.iceParameters,
//       iceCandidates: transport.iceCandidates,
//       dtlsParameters: transport.dtlsParameters
//     });
//     socket.transport = transport;
//   });

//   socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
//     await socket.transport.connect({ dtlsParameters });
//     callback();
//   });

//   socket.on('produce', async ({ kind, rtpParameters, sessionId }, callback) => {
//     const producer = await socket.transport.produce({ kind, rtpParameters });
//     socket.producer = producer;
//     io.to(sessionId).emit('newProducer', { producerId: producer.id, kind });
//     callback({ id: producer.id });
//   });

//   socket.on('createConsumerTransport', async (callback) => {
//     const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
//     callback({
//       id: transport.id,
//       iceParameters: transport.iceParameters,
//       iceCandidates: transport.iceCandidates,
//       dtlsParameters: transport.dtlsParameters
//     });
//   });

//   socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
//     const transport = router.transports.find(t => t.id === transportId);
//     await transport.connect({ dtlsParameters });
//     callback();
//   });

//   socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
//     if (router.canConsume({ producerId, rtpCapabilities })) {
//       const transport = router.transports.find(t => t.appData.socketId === socket.id);
//       const consumer = await transport.consume({
//         producerId,
//         rtpCapabilities,
//         paused: false
//       });
//       callback({
//         id: consumer.id,
//         producerId,
//         kind: consumer.kind,
//         rtpParameters: consumer.rtpParameters
//       });
//     }
//   });

//   socket.on('join', ({ sessionId }) => {
//     socket.join(sessionId);
//   });

//   socket.on('disconnect', () => {
//     if (socket.producer) socket.producer.close();
//     if (socket.transport) socket.transport.close();
//   });
// });

// server.js - Complete server setup
const express = require('express');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Configuration
const config = {
  listenIp: '0.0.0.0',
  listenPort: 5000,
  mediasoup: {
    worker: {
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp']
    },
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ]
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: '127.0.0.1'
        }
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }
  }
};

const httpServer = app.listen(config.listenPort, () => {
  console.log(`🚀 Server running on http://localhost:${config.listenPort}`);
  console.log(`📁 Frontend files served from: ${path.join(__dirname, 'frontend')}`);
});

const io = new Server(httpServer, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

// Global variables
let worker, router;
const sessions = new Map();
const transports = new Map();
const producers = new Map();
const consumers = new Map();

// Initialize MediaSoup
async function startMediasoup() {
  try {
    console.log('🔧 Starting MediaSoup worker...');
    worker = await mediasoup.createWorker(config.mediasoup.worker);
    
    worker.on('died', (error) => {
      console.error('❌ MediaSoup worker died:', error);
      setTimeout(() => process.exit(1), 2000);
    });

    console.log('🔧 Creating MediaSoup router...');
    router = await worker.createRouter({ 
      mediaCodecs: config.mediasoup.router.mediaCodecs 
    });
    
    console.log('✅ MediaSoup initialized successfully');
  } catch (error) {
    console.error('❌ Error starting MediaSoup:', error);
    process.exit(1);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mediasoup: !!router 
  });
});

// API Routes
app.post('/api/create-session', (req, res) => {
  try {
    const { teacherName, sessionName } = req.body;
    
    if (!teacherName || !sessionName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Teacher name and session name are required' 
      });
    }

    const sessionId = uuidv4();
    const userId = uuidv4();
    
    sessions.set(sessionId, {
      id: sessionId,
      name: sessionName,
      teacher: { id: userId, name: teacherName },
      students: new Map(),
      producers: new Map(),
      createdAt: new Date()
    });
    
    console.log(`📚 Session created: ${sessionId} by ${teacherName}`);
    res.json({ success: true, sessionId, userId });
  } catch (error) {
    console.error('❌ Error creating session:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/join-session', (req, res) => {
  try {
    const { sessionId, userName, isTeacher } = req.body;
    
    if (!sessionId || !userName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Session ID and user name are required' 
      });
    }
    
    if (!sessions.has(sessionId)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    const userId = uuidv4();
    const session = sessions.get(sessionId);
    
    if (!isTeacher) {
      session.students.set(userId, { id: userId, name: userName });
      console.log(`👨‍🎓 Student joined: ${userName} (${userId})`);
    }
    
    res.json({ success: true, sessionId, userId });
  } catch (error) {
    console.error('❌ Error joining session:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/router-capabilities', (req, res) => {
  try {
    if (!router) {
      return res.status(503).json({ 
        error: 'MediaSoup router not ready' 
      });
    }
    res.json({ rtpCapabilities: router.rtpCapabilities });
  } catch (error) {
    console.error('❌ Error getting router capabilities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('join', ({ sessionId, userId }) => {
    try {
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.userId = userId;
      
      const session = sessions.get(sessionId);
      if (session) {
        const user = session.teacher.id === userId ? 
          session.teacher : 
          session.students.get(userId);
        
        if (user) {
          socket.to(sessionId).emit('user_joined', {
            userId,
            name: user.name,
            isTeacher: session.teacher.id === userId
          });
          console.log(`👤 User joined session: ${user.name}`);
        }
      }
    } catch (error) {
      console.error('❌ Error joining session:', error);
      socket.emit('error', { message: 'Failed to join session' });
    }
  });

  socket.on('createProducerTransport', async (callback) => {
    try {
      if (!router) {
        return callback({ error: 'Router not available' });
      }

      const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
      transports.set(transport.id, transport);
      socket.producerTransportId = transport.id;
      
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log('🔒 Producer transport closed');
      });
      
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error('❌ Error creating producer transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('createConsumerTransport', async (callback) => {
    try {
      if (!router) {
        return callback({ error: 'Router not available' });
      }

      const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
      transports.set(transport.id, transport);
      socket.consumerTransportId = transport.id;
      
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log('🔒 Consumer transport closed');
      });
      
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error('❌ Error creating consumer transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
    try {
      const transport = transports.get(socket.producerTransportId);
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }
      
      await transport.connect({ dtlsParameters });
      callback();
    } catch (error) {
      console.error('❌ Error connecting producer transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectConsumerTransport', async ({ dtlsParameters }, callback) => {
    try {
      const transport = transports.get(socket.consumerTransportId);
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }
      
      await transport.connect({ dtlsParameters });
      callback();
    } catch (error) {
      console.error('❌ Error connecting consumer transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('produce', async ({ kind, rtpParameters, sessionId }, callback) => {
    try {
      const transport = transports.get(socket.producerTransportId);
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }

      const producer = await transport.produce({ kind, rtpParameters });
      
      producers.set(producer.id, {
        producer,
        socketId: socket.id,
        sessionId,
        userId: socket.userId
      });

      producer.on('transportclose', () => {
        console.log('🔒 Producer transport closed');
        producer.close();
      });

      // Update session with producer info
      const session = sessions.get(sessionId);
      if (session) {
        session.producers.set(producer.id, {
          id: producer.id,
          kind,
          userId: socket.userId
        });
      }

      // Notify other participants
      socket.to(sessionId).emit('newProducer', { 
        producerId: producer.id, 
        kind,
        userId: socket.userId
      });
      
      console.log(`🎥 Producer created: ${kind} (${producer.id})`);
      callback({ id: producer.id });
    } catch (error) {
      console.error('❌ Error producing:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }

      const transport = transports.get(socket.consumerTransportId);
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false
      });

      consumers.set(consumer.id, {
        consumer,
        socketId: socket.id,
        producerId
      });

      consumer.on('transportclose', () => {
        console.log('🔒 Consumer transport closed');
        consumer.close();
      });

      consumer.on('producerclose', () => {
        console.log('🔒 Consumer producer closed');
        consumer.close();
      });

      console.log(`🎬 Consumer created: ${consumer.kind} (${consumer.id})`);
      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });
    } catch (error) {
      console.error('❌ Error consuming:', error);
      callback({ error: error.message });
    }
  });

  socket.on('streamEnded', ({ sessionId, userId }) => {
    socket.to(sessionId).emit('stream_ending');
  });

  socket.on('leave', ({ sessionId, userId }) => {
    socket.to(sessionId).emit('user_left', { userId });
    socket.leave(sessionId);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    // Clean up producers
    for (const [id, producerData] of producers.entries()) {
      if (producerData.socketId === socket.id) {
        producerData.producer.close();
        producers.delete(id);
        
        if (socket.sessionId) {
          socket.to(socket.sessionId).emit('producerClosed', { producerId: id });
        }
      }
    }

    // Clean up consumers
    for (const [id, consumerData] of consumers.entries()) {
      if (consumerData.socketId === socket.id) {
        consumerData.consumer.close();
        consumers.delete(id);
      }
    }

    // Clean up transports
    if (socket.producerTransportId) {
      const transport = transports.get(socket.producerTransportId);
      if (transport) {
        transport.close();
        transports.delete(socket.producerTransportId);
      }
    }

    if (socket.consumerTransportId) {
      const transport = transports.get(socket.consumerTransportId);
      if (transport) {
        transport.close();
        transports.delete(socket.consumerTransportId);
      }
    }

    // Notify session about user leaving
    if (socket.sessionId && socket.userId) {
      socket.to(socket.sessionId).emit('user_left', { userId: socket.userId });
    }
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startMediasoup().then(() => {
  console.log('✅ MediaSoup server started successfully');
}).catch((error) => {
  console.error('❌ Failed to start MediaSoup server:', error);
  process.exit(1);
});