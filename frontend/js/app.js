const socket = io('http://127.0.0.1:5000');
let device, producerTransport, consumerTransport, producers = new Map(), consumers = new Map();
let userId, sessionId, isTeacher, currentStream = null;
let participants = [];

document.addEventListener('DOMContentLoaded', () => {
  const joinForm = document.getElementById('joinForm');
  if (joinForm) {
    joinForm.addEventListener('submit', joinSession);
  } else {
    init();
  }
});

async function joinSession(event) {
  event.preventDefault();
  const userType = document.getElementById('userType').value;
  const userName = document.getElementById('userName').value.trim();
  const inputSessionId = document.getElementById('sessionId').value.trim();
  const status = document.getElementById('status');

  if (!userName) {
    status.textContent = 'Error: Name is required';
    return;
  }

  isTeacher = userType === 'teacher';

  try {
    status.textContent = 'Connecting...';
    
    if (isTeacher) {
      const response = await fetch('http://127.0.0.1:5000/api/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherName: userName, sessionName: 'Class Session' })
      });
      
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      
      sessionId = data.sessionId;
      userId = data.userId;
      
      localStorage.setItem('sessionId', sessionId);
      localStorage.setItem('userId', userId);
      localStorage.setItem('userName', userName);
      localStorage.setItem('isTeacher', 'true');
      
      window.sessionData = { sessionId, userId, userName, isTeacher: true };
      window.location.href = 'teacher.html';
    } else {
      if (!inputSessionId) throw new Error('Session ID required for students');
      
      const response = await fetch('http://127.0.0.1:5000/api/join-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: inputSessionId, userName, isTeacher: false })
      });
      
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      
      sessionId = data.sessionId;
      userId = data.userId;
      participants = data.participants || [];
      
      localStorage.setItem('sessionId', sessionId);
      localStorage.setItem('userId', userId);
      localStorage.setItem('userName', userName);
      localStorage.setItem('isTeacher', 'false');
      
      window.sessionData = { sessionId, userId, userName, isTeacher: false };
      window.location.href = 'student.html';
    }
  } catch (error) {
    console.error('Join session error:', error);
    status.textContent = `Error: ${error.message}`;
  }
}

async function init() {
  const status = document.getElementById('status');
  
  try {
    if (window.sessionData) {
      userId = window.sessionData.userId;
      sessionId = window.sessionData.sessionId;
      isTeacher = window.sessionData.isTeacher;
    } else {
      userId = localStorage.getItem('userId');
      sessionId = localStorage.getItem('sessionId');
      isTeacher = localStorage.getItem('isTeacher') === 'true';
    }

    if (!userId || !sessionId) {
      status.textContent = 'Error: Invalid session. Please join again.';
      setTimeout(() => window.location.href = 'index.html', 2000);
      return;
    }

    status.textContent = 'Initializing...';

    const userName = window.sessionData?.userName || localStorage.getItem('userName') || (isTeacher ? 'Teacher' : 'Student');
    
    if (isTeacher) {
      document.getElementById('teacherName').textContent = userName;
      document.getElementById('sessionId').textContent = sessionId;
    } else {
      document.getElementById('studentName').textContent = userName;
      document.getElementById('sessionId').textContent = sessionId;
    }

    socket.emit('join', { sessionId, userId });
    
    device = new mediasoupClient.Device();
    const response = await fetch('http://127.0.0.1:5000/api/router-capabilities');
    const data = await response.json();
    await device.load({ routerRtpCapabilities: data.rtpCapabilities });

    status.textContent = 'Connected and ready';
    updateParticipantList();

    setupEventHandlers();
    setupSocketHandlers();
  } catch (error) {
    console.error('Initialization error:', error);
    status.textContent = `Error: ${error.message}`;
  }
}

function setupEventHandlers() {
  if (isTeacher) {
    const startVideoBtn = document.getElementById('startVideo');
    const shareScreenBtn = document.getElementById('shareScreen');
    const stopStreamBtn = document.getElementById('stopStream');
    const leaveSessionBtn = document.getElementById('leaveSession');
    
    startVideoBtn.onclick = () => startStream('video');
    shareScreenBtn.onclick = () => startStream('screen');
    stopStreamBtn.onclick = stopStream;
    leaveSessionBtn.onclick = leaveSession;
  } else {
    const leaveSessionBtn = document.getElementById('leaveSession');
    leaveSessionBtn.onclick = leaveSession;
  }

  const qualitySelect = document.getElementById('qualitySelect');
  if (qualitySelect) {
    qualitySelect.onchange = (e) => {
      const quality = e.target.value;
      updateQuality(quality);
    };
  }
}

function setupSocketHandlers() {
  socket.on('newProducer', async ({ producerId, kind, userId: producerUserId }) => {
    console.log('New producer detected:', producerId, kind, 'from user:', producerUserId);
    if (!isTeacher) {
      await consumeStream(producerId, kind);
    }
  });

  socket.on('user_joined', (user) => {
    console.log('User joined:', user);
    participants.push(user);
    updateParticipantList();
  });

  socket.on('user_left', ({ userId: leftUserId }) => {
    console.log('User left:', leftUserId);
    participants = participants.filter(p => p.userId !== leftUserId);
    updateParticipantList();
  });

  socket.on('livestream_started', () => {
    console.log('Livestream started');
    const status = document.getElementById('status');
    if (status) status.textContent = 'Livestream started';
  });

  socket.on('livestream_ended', () => {
    console.log('Livestream ended');
    if (!isTeacher) {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) remoteVideo.srcObject = null;
      const status = document.getElementById('status');
      if (status) status.textContent = 'Livestream ended';
    }
  });

  socket.on('producerClosed', ({ producerId }) => {
    console.log('Producer closed:', producerId);
    const consumer = consumers.get(producerId);
    if (consumer) {
      consumer.close();
      consumers.delete(producerId);
    }
    if (!isTeacher) {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo && remoteVideo.srcObject) {
        const stream = remoteVideo.srcObject;
        stream.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
      }
      const status = document.getElementById('status');
      if (status) status.textContent = 'Stream ended';
    }
  });

  socket.on('error', ({ message }) => {
    console.error('Socket error:', message);
    const status = document.getElementById('status');
    if (status) status.textContent = `Error: ${message}`;
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    if (sessionId && userId) {
      socket.emit('join', { sessionId, userId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
    const status = document.getElementById('status');
    if (status) status.textContent = 'Disconnected from server';
  });
}

async function startStream(type) {
  const status = document.getElementById('status');
  try {
    status.textContent = 'Starting stream...';
    
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      producers.forEach(producer => producer.close());
      producers.clear();
    }
    
    let stream;
    if (type === 'video') {
      stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }, 
        audio: true 
      });
    } else if (type === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          width: { ideal: 1920 }, 
          height: { ideal: 1080 }
        },
        audio: true
      });
    }

    currentStream = stream;
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = stream;

    const response = await fetch('http://127.0.0.1:5000/api/start-livestream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error);

    producerTransport = await createTransport('producer');

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const videoProducer = await producerTransport.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000 },  // Low
          { maxBitrate: 300000 },  // Medium
          { maxBitrate: 900000 }   // High
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        }
      });
      producers.set(videoProducer.id, videoProducer);
      videoProducer.on('trackended', () => stopStream());
      console.log('Video producer created:', videoProducer.id);
    } else {
      console.warn('No video track found in the stream');
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const audioProducer = await producerTransport.produce({ track: audioTrack });
      producers.set(audioProducer.id, audioProducer);
      audioProducer.on('trackended', () => console.log('Audio track ended'));
      console.log('Audio producer created:', audioProducer.id);
    } else {
      console.warn('No audio track found in the stream');
    }

    status.textContent = 'Streaming started successfully';
    
    document.getElementById('startVideo').disabled = true;
    document.getElementById('shareScreen').disabled = true;
    document.getElementById('stopStream').disabled = false;
    
  } catch (error) {
    console.error('Start stream error:', error);
    status.textContent = `Error starting stream: ${error.message}`;
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
  }
}

async function stopStream() {
  const status = document.getElementById('status');
  try {
    status.textContent = 'Stopping stream...';
    
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = null;
    
    producers.forEach(producer => producer.close());
    producers.clear();
    
    if (producerTransport) {
      producerTransport.close();
      producerTransport = null;
    }
    
    await fetch('http://127.0.0.1:5000/api/stop-livestream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId })
    });
    
    status.textContent = 'Stream stopped';
    
    document.getElementById('startVideo').disabled = false;
    document.getElementById('shareScreen').disabled = false;
    document.getElementById('stopStream').disabled = true;
    
  } catch (error) {
    console.error('Stop stream error:', error);
    status.textContent = `Error stopping stream: ${error.message}`;
  }
}

async function createTransport(type) {
  const isProducer = type === 'producer';
  const eventName = isProducer ? 'createProducerTransport' : 'createConsumerTransport';
  
  return new Promise((resolve, reject) => {
    socket.emit(eventName, (response) => {
      if (response && response.error) {
        console.error(`Error in ${eventName}:`, response.error);
        reject(new Error(response.error));
        return;
      }

      if (!response || !response.id) {
        const errorMsg = `Invalid response from ${eventName}: ${JSON.stringify(response)}`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      try {
        const transport = device[isProducer ? 'createSendTransport' : 'createRecvTransport'](response);
        
        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', { transportId: transport.id, dtlsParameters }, (response) => {
            if (response && response.error) {
              console.error('Error connecting transport:', response.error);
              errback(new Error(response.error));
            } else {
              callback();
            }
          });
        });

        if (isProducer) {
          transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
            socket.emit('produce', { transportId: transport.id, kind, rtpParameters, sessionId, userId }, (response) => {
              if (response && response.error) {
                console.error('Error producing:', response.error);
                errback(new Error(response.error));
              } else if (response && response.id) {
                callback({ id: response.id });
              } else {
                const errorMsg = 'Invalid produce response: ' + JSON.stringify(response);
                console.error(errorMsg);
                errback(new Error(errorMsg));
              }
            });
          });
        }

        transport.on('connectionstatechange', (state) => {
          console.log(`${type} transport connection state:`, state);
          if (state === 'failed') {
            console.error(`${type} transport failed to connect`);
            reject(new Error(`${type} transport connection failed`));
          }
        });

        resolve(transport);
      } catch (error) {
        console.error(`Error creating ${type} transport:`, error);
        reject(error);
      }
    });
  });
}

async function consumeStream(producerId, kind) {
  try {
    console.log('Starting to consume stream:', producerId, kind);
    
    if (!consumerTransport) {
      consumerTransport = await createTransport('consumer');
    }
    
    const response = await new Promise((resolve, reject) => {
      socket.emit('consume', { 
        transportId: consumerTransport.id,
        producerId, 
        rtpParameters: device.rtpCapabilities 
      }, (response) => {
        if (response && response.error) {
          console.error('Error consuming stream:', response.error);
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });

    const consumer = await consumerTransport.consume({
      id: response.id,
      producerId: response.producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters
    });

    consumers.set(producerId, consumer);

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    consumer.on('trackended', () => console.log('Consumer track ended'));
    consumer.on('transportclose', () => console.log('Consumer transport closed'));

    if (kind === 'video') {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
        if (remoteVideo.srcObject) {
          remoteVideo.srcObject.addTrack(consumer.track);
        } else {
          remoteVideo.srcObject = stream;
        }
      }
    } else if (kind === 'audio') {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo && remoteVideo.srcObject) {
        remoteVideo.srcObject.addTrack(consumer.track);
      }
    }

    console.log('Consumer created successfully:', consumer.id);
    
  } catch (error) {
    console.error('Consume stream error:', error);
    const status = document.getElementById('status');
    if (status) status.textContent = `Error consuming stream: ${error.message}`;
  }
}

function updateQuality(quality) {
  const qualityMap = {
    'low': 0,    // First encoding (100 kbps)
    'medium': 1, // Second encoding (300 kbps)
    'high': 2    // Third encoding (900 kbps)
  };
  const level = qualityMap[quality] || 1;
  
  consumers.forEach(consumer => {
    if (consumer.kind === 'video') {
      consumer.setPreferredLayers({ spatialLayer: level, temporalLayer: level });
    }
  });
}

async function leaveSession() {
  try {
    if (isTeacher && currentStream) await stopStream();
    
    if (producerTransport) producerTransport.close();
    if (consumerTransport) consumerTransport.close();
    
    producers.forEach(producer => producer.close());
    producers.clear();
    consumers.forEach(consumer => consumer.close());
    consumers.clear();
    
    await fetch('http://127.0.0.1:5000/api/leave-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId })
    });
    
    socket.emit('leave', { sessionId, userId });
    
    localStorage.clear();
    window.sessionData = null;
    window.location.href = 'index.html';
    
  } catch (error) {
    console.error('Leave session error:', error);
    window.location.href = 'index.html';
  }
}

function updateParticipantList() {
  const participantList = document.getElementById('participantList');
  if (participantList) {
    participantList.innerHTML = participants.map(p => `<li>${p.name} (${p.isTeacher ? 'Teacher' : 'Student'})</li>`).join('');
  }
}

// Clean up on page unload (refresh or close)
window.addEventListener('beforeunload', async () => {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }
  if (producerTransport) producerTransport.close();
  if (consumerTransport) consumerTransport.close();

  // Use navigator.sendBeacon for a reliable cleanup request
  const blob = new Blob([JSON.stringify({ sessionId, userId })], { type: 'application/json' });
  navigator.sendBeacon('http://127.0.0.1:5000/api/leave-session', blob);

  socket.emit('leave', { sessionId, userId });
});